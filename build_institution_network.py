import requests
import pandas as pd
import time
from collections import Counter, defaultdict
from tqdm import tqdm

def fetch_openalex_data(api_filter, max_papers=100):
    base_url = "https://api.openalex.org/works"

    params = {
        "filter": api_filter,
        "per_page": 50,
        "select": "id,publication_year,authorships,referenced_works",
        "sort": "cited_by_count:desc",  # Ensure we get high-impact "hubs"
        "mailto": "dedau1691@gmail.com",
    }

    papers = []
    cursor = "*"

    while len(papers) < max_papers:
        params["cursor"] = cursor
        response = requests.get(base_url, params=params)

        if response.status_code != 200:
            print(f"Error: {response.status_code}")
            break

        data = response.json()
        results = data.get("results", [])
        if not results:
            break

        papers.extend(results)
        cursor = data.get("meta", {}).get("next_cursor")
        if not cursor:
            break

        time.sleep(0.1)
    
    return papers[:max_papers]




def build_institution_geo_dict(papers_data):
    """
    Scans only the FIRST AUTHOR of each paper to build a coordinate dictionary.
    """
    unique_insts = {}

    print("Scanning papers for Lead Institutions...")
    for paper in papers_data:
        authorships = paper.get("authorships", [])
        if not authorships:
            continue

        lead_author = authorships[0]
        for inst in lead_author.get("institutions", []):
            if inst.get("id") is not None:
                inst_id = inst.get("id").split('/')[-1]
                if inst_id and inst_id not in unique_insts:
                    unique_insts[inst_id] = {
                        "name": inst.get("display_name"),
                        "country": inst.get("country_code", ""),
                        "lat": None,
                        "lng": None,
                    }

    print(f"Fetching geo data from OpenAlex for {len(unique_insts)} institutions...")
    inst_ids = list(unique_insts.keys())
    batch_size = 50

    for i in range(0, len(inst_ids), batch_size):
        batch = inst_ids[i : i + batch_size]
        short_ids = [iid.replace("https://openalex.org/", "") for iid in batch]
        ids_filter = "|".join(short_ids)

        try:
            response = requests.get(
                "https://api.openalex.org/institutions",
                params={
                    "filter": f"openalex:{ids_filter}",
                    "select": "id,display_name,geo",
                    "per_page": 50,
                    "mailto": "dedau1691@gmail.com",
                },
            )
            if response.status_code == 200:
                for item in response.json().get("results", []):
                    geo = item.get("geo", {})
                    latitude = geo.get("latitude")
                    longitude = geo.get("longitude")
                    if latitude is not None and longitude is not None:
                        unique_insts[item["id"].split('/')[-1]]["lat"] = latitude
                        unique_insts[item["id"].split('/')[-1]]["lng"] = longitude
        except Exception as e:
            print(f"OpenAlex batch error: {e}")

        # Just to make sure we avoid rate limits
        time.sleep(0.2)

    return unique_insts

def fetch_missing_referenced_papers(referenced_ids):
    """Fetches authorship/institution data for papers cited but not in original set."""
    if not referenced_ids:
        return []
        
    base_url = "https://api.openalex.org/works"
    extra_papers = []
    
    # Strip any URL prefixes to keep the filter payload small
    clean_ids = [rid.replace("https://openalex.org/", "") for rid in referenced_ids]
    
    # OPTIMIZATION 1: Max out batch size to 100
    batch_size = 100 
    
    print(f"Fetching authorship profiles in optimized batches of 100...", len(clean_ids))
    
    for i in tqdm(range(0, len(clean_ids), batch_size)):
        batch = clean_ids[i : i + batch_size]
        ids_filter = "|".join(batch)
        
        try:
            response = requests.get(
                base_url,
                params={
                    "filter": f"openalex:{ids_filter}",
                    # OPTIMIZATION 2: Only fetch the bare minimum needed for your loop
                    "select": "id,authorships,publication_year", 
                    "per_page": 100,
                    "mailto": "dedau1691@gmail.com",
                }
            )
            if response.status_code == 200:
                extra_papers.extend(response.json().get("results", []))
            else:
                print(f"Batch warning: Status {response.status_code}")
        except Exception as e:
            print(f"Network error in batch: {e}")
            
        time.sleep(0.1)

    return extra_papers
    

def build_edges_with_geo_dict(papers_data, geo_dict):
    """
    Creates edges strictly between the Lead Institutions of citing and cited papers.
    """
    inst_edges = {}
    paper_to_lead_insts = {}

    year_source_counts = defaultdict(Counter)
    year_target_counts = defaultdict(Counter)

    year_source_to_targets = defaultdict(lambda: defaultdict(Counter))
    year_target_to_sources = defaultdict(lambda: defaultdict(Counter))


    # 1. Map EVERY paper (main and referenced) to its lead author's institutions
    for paper in papers_data:
        authorships = paper.get("authorships", [])
        if not authorships:
            continue

        lead_insts = []
        for inst in authorships[0].get("institutions", []):
            if inst.get("id") is None:
                continue
            inst_id = inst.get("id").split('/')[-1]
            if (
                inst_id in geo_dict
                and geo_dict[inst_id]["lat"] is not None
                and geo_dict[inst_id]["lng"] is not None
            ):
                # Save as an object containing the ID so c["id"] works smoothly later
                lead_insts.append({
                    "id": inst_id, 
                    "lat": geo_dict[inst_id]["lat"], 
                    "lng": geo_dict[inst_id]["lng"]
                })

        paper_to_lead_insts[paper["id"]] = lead_insts

    # 2. Build the network edges ONLY for papers that are doing the citing
    for paper in papers_data:
        # Skip generating edges if this paper is just a referenced stub 
        # (it doesn't have "referenced_works" populated anyway)
        if "referenced_works" not in paper:
            continue
            
        citing_id = paper["id"]
        citing_leads = paper_to_lead_insts.get(citing_id, [])
        year = paper.get("publication_year")

        for cited_id in paper.get("referenced_works", []):
            # Now this block will pass successfully because cited_id is in the map!
            if cited_id in paper_to_lead_insts:
                cited_leads = paper_to_lead_insts[cited_id]

                for c in citing_leads:
                    for r in cited_leads:
                        if c["id"] != r["id"]:
                            # check if the entry already exists in inst_edges, if so, increment the weight instead of adding a new entry
                            if (c["id"], r["id"], year) in inst_edges:
                                inst_edges[(c["id"], r["id"], year)]["weight"] += 1.0
                            else:
                                inst_edges[(c["id"], r["id"], year)] = {
                                    "source_id": c["id"],
                                        "target_id": r["id"],
                                        "publication_year": year,
                                        "weight": 1.0,
                                    }
                            year_source_counts[year][c["id"]] += 1
                            year_target_counts[year][r["id"]] += 1
                            
                            year_source_to_targets[year][c["id"]][r["id"]] += 1
                            year_target_to_sources[year][r["id"]][c["id"]] += 1


    all_years = sorted(list(year_source_counts.keys()))

    top_sources_by_year = {}
    top_targets_by_year = {}
    reciprocal_edges_by_year = {}

    for year in all_years:
        # --- Top 5 Sources for this specific year ---
        top_sources_by_year[year] = {}
        for s_id, total_count in year_source_counts[year].most_common(5):
            top_3_targets = year_source_to_targets[year][s_id].most_common(3)
            #add coord and name of institution to the sources and targets
            for t_id, count in top_3_targets:
                if t_id in geo_dict:
                    top_3_targets[top_3_targets.index((t_id, count))] = {
                        "target_id": t_id,
                        "count": count
                    }
            top_sources_by_year[year][s_id] = {
                "source_frequency_this_year": total_count,
                "top_3_targets": top_3_targets
            }

        # --- Top 5 Targets for this specific year ---
        top_targets_by_year[year] = {}
        for t_id, total_count in year_target_counts[year].most_common(5):
            top_3_sources = year_target_to_sources[year][t_id].most_common(3)
            #add coord and name of institution to the sources and targets
            for s_id, count in top_3_sources:
                if s_id in geo_dict:
                    top_3_sources[top_3_sources.index((s_id, count))] = {
                        "source_id": s_id,
                        "count": count
                    }
            top_targets_by_year[year][t_id] = {
                "target_frequency_this_year": total_count,
                "top_3_sources": top_3_sources
            }

        # Top 5 strongest reciprocal edges for this year
        reciprocal_edges = {}
        for (s_id, t_id, edge_year), edge_data in inst_edges.items():
            if edge_year == year and (t_id, s_id, year) in inst_edges:
                reciprocal_weight = min(edge_data["weight"], inst_edges[(t_id, s_id, year)]["weight"])
                if (t_id, s_id) not in reciprocal_edges: 
                    reciprocal_edges[(s_id, t_id)] = reciprocal_weight
        # Sort by weight in descending order and take the top 5
        reciprocal_edges = sorted(reciprocal_edges.items(), key=lambda x: x[1], reverse=True)[:5]
        top_reciprocal_edges = reciprocal_edges[:5]
        print(top_reciprocal_edges)
        print(f"Year {year} - Top 5 Reciprocal Edges:")
        for (s_id, t_id), weight in top_reciprocal_edges:
            print(f"  {s_id} <-> {t_id} with reciprocal weight {weight}")
        reciprocal_edges_by_year[year] = top_reciprocal_edges

    #identify the institutions that appear as both source and target in both the very first and very last year of the dataset
    first_year = min(reciprocal_edges_by_year.keys())
    last_year = max(reciprocal_edges_by_year.keys())
    institutions = year_source_counts[first_year].keys() & year_target_counts[first_year].keys() & year_source_counts[last_year].keys() & year_target_counts[last_year].keys()
    print(f"Institutions that are both sources and targets in the first and last year: {institutions}")
    #compute the difference between the first and last year of the delta in source and target frequency for these institutions
    score_deltas = {}
    for inst in institutions:
        score_delta = ((year_target_counts[last_year][inst] - year_source_counts[last_year][inst]), (year_target_counts[first_year][inst] - year_source_counts[first_year][inst]))
        score_deltas[inst] = score_delta
        print(f"Institution {inst} - Score Delta: {score_delta}")

    return pd.DataFrame(list(inst_edges.values())), top_sources_by_year, top_targets_by_year, reciprocal_edges_by_year, score_deltas


def fetch_all_years_raw_data(
    topic_id, start_year=2010, end_year=2025, papers_per_year=10000
):
    """
    Fetches raw paper data (JSON) for a range of years and returns one big list.
    """
    all_papers = []

    for year in range(start_year, end_year + 1):
        api_filter = f"primary_topic.id:{topic_id},publication_year:{year}"
        print(f"--- Fetching Raw Data for {year} ---")

        # Use your existing fetch_openalex_data function
        year_papers = fetch_openalex_data(api_filter, max_papers=papers_per_year)

        if year_papers:
            all_papers.extend(year_papers)
            print(f"Added {len(year_papers)} papers from {year}.")

        time.sleep(0.5)

    return all_papers

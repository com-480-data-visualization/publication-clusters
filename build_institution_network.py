import requests
import pandas as pd
import time


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


import time
import pandas as pd
from geopy.geocoders import Nominatim


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
            inst_id = inst.get("id")
            if inst_id and inst_id not in unique_insts:
                unique_insts[inst_id] = {
                    "name": inst.get("display_name"),
                    "country": inst.get("country_code", ""),
                    "coords": None,
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
                        unique_insts[item["id"]]["coords"] = (latitude, longitude)
        except Exception as e:
            print(f"OpenAlex batch error: {e}")

        # Just to make sure we avoid rate limits
        time.sleep(0.2)

    return unique_insts


def build_edges_with_geo_dict(papers_data, geo_dict):
    """
    Creates edges strictly between the Lead Institutions of citing and cited papers.
    """
    inst_edges = []
    paper_to_lead_insts = {}

    # 1. Map every paper to its FIRST AUTHOR'S institutions
    for paper in papers_data:
        authorships = paper.get("authorships", [])
        if not authorships:
            continue

        lead_insts = []
        # We take authorships[0] as the Lead Author
        for inst in authorships[0].get("institutions", []):
            inst_id = inst.get("id")
            if (
                inst_id in geo_dict
                and type(geo_dict[inst_id]["coords"]) != float
                and geo_dict[inst_id]["coords"] is not None
            ):
                if isinstance(geo_dict[inst_id]["coords"], str):
                    geo_dict[inst_id]["coords"] = tuple(
                        map(float, geo_dict[inst_id]["coords"].strip("()").split(", "))
                    )
                lat, lng = geo_dict[inst_id]["coords"]
                lead_insts.append({"id": inst_id, "lat": lat, "lng": lng})

        paper_to_lead_insts[paper["id"]] = lead_insts

    # 2. Build the network edges
    for paper in papers_data:
        citing_id = paper["id"]
        citing_leads = paper_to_lead_insts.get(citing_id, [])

        for cited_id in paper.get("referenced_works", []):
            # Only draw a line if the cited paper is in our 'Lead Lab' map
            if cited_id in paper_to_lead_insts:
                cited_leads = paper_to_lead_insts[cited_id]

                for c in citing_leads:
                    for r in cited_leads:
                        if c["id"] != r["id"]:
                            inst_edges.append(
                                {
                                    "source_id": c["id"],
                                    "source_lat": c["lat"],
                                    "source_lng": c["lng"],
                                    "target_id": r["id"],
                                    "target_lat": r["lat"],
                                    "target_lng": r["lng"],
                                    "publication_year": paper.get("publication_year"),
                                    "weight": 1.0,
                                }
                            )

    return pd.DataFrame(inst_edges)


def fetch_all_years_raw_data(
    topic_id, start_year=2010, end_year=2025, papers_per_year=100
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

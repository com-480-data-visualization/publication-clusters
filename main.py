from build_institution_network import (
    fetch_all_years_raw_data,
    build_institution_geo_dict,
    build_edges_with_geo_dict,
    fetch_missing_referenced_papers,
)
from preliminary_visualization import generate_geospatial_evolution
import pandas as pd
import os
import argparse

# Topic_ids: T10411 = Solar Cells, T10237 = LHC, T10064 = Complex Network Analysis, T10463 = Pulsars and Gravitational Waves Research, T10049 = Magnetic properties of thin films
topic_dict = {
    "T10411": "Solar Cells",
    "T10237": "LHC",
    "T10064": "Complex Network Analysis",
    "T10463": "Gravitational Waves",
    "T10049": "Magnetic Thin Films"
}
START_YEAR, END_YEAR = 2005, 2025
PAPER_PER_YEAR = 1000




def main(TOPIC_ID, TOPIC_NAME):
    if not os.path.exists("data"):
        os.makedirs("data")

    if os.path.exists(
        f"data/institution_network_evolution_{TOPIC_NAME.replace(' ', '_')}_{START_YEAR}_{END_YEAR}.csv"
    ) and os.path.exists(f"data/geo_dict_{TOPIC_NAME.replace(' ', '_')}.csv"):
        print("Loading existing evolution data from CSV...")
        evolution_df = pd.read_csv(
            f"data/institution_network_evolution_{TOPIC_NAME.replace(' ', '_')}_{START_YEAR}_{END_YEAR}.csv"
        )
        geo_dict = pd.read_csv(
            f"data/geo_dict_{TOPIC_NAME.replace(' ', '_')}.csv", index_col=0
        ).to_dict(orient="index")
    else:
        raw_data = fetch_all_years_raw_data(
            TOPIC_ID, start_year=START_YEAR, end_year=END_YEAR, papers_per_year=PAPER_PER_YEAR
        )
        all_referenced_ids = set()
        existing_paper_ids = {p["id"] for p in raw_data}
        for paper in raw_data:
            for ref in paper.get("referenced_works", []):
                #check if ref is already in raw_data by comparing with paper ids in raw_data
                if ref not in existing_paper_ids:
                    all_referenced_ids.add(ref)
        referenced_papers_data = fetch_missing_referenced_papers(list(all_referenced_ids))
        raw_data = raw_data + referenced_papers_data

        # check if data/geo_dict_{TOPIC_NAME.replace(' ', '_')}.csv exists
        if os.path.exists(f"data/geo_dict_{TOPIC_NAME.replace(' ', '_')}.csv"):
            print("Loading existing Geo Dictionary from CSV...")
            geo_dict = pd.read_csv(
                f"data/geo_dict_{TOPIC_NAME.replace(' ', '_')}.csv", index_col=0
            ).to_dict(orient="index")
        else:
            print("Starting Geocoding process...")
            geo_dict = build_institution_geo_dict(raw_data)
            # save the geo_dict to a CSV for later use
            geo_df = pd.DataFrame.from_dict(geo_dict, orient="index")
            geo_df.to_csv(f"data/geo_dict_{TOPIC_NAME.replace(' ', '_')}.csv")
        
        print("Building the evolution network...")
        evolution_df, top_sources_by_year, top_targets_by_year, reciprocal_edges_by_year, score_deltas = build_edges_with_geo_dict(raw_data, geo_dict)
        print("--- Source ---")
        for year in top_sources_by_year:
            print(f"Year: {year}")
            for s_id, details in top_sources_by_year[year].items():
                print(f"  Source ID: {s_id}, Frequency: {details['source_frequency_this_year']}")
        print("--- Target ---")
        for year in top_targets_by_year:
            print(f"Year: {year}")
            for t_id, details in top_targets_by_year[year].items():
                print(f"  Target ID: {t_id}, Frequency: {details['target_frequency_this_year']}")
        print("--- Reciprocal Edges ---")
        for year in reciprocal_edges_by_year:
            print(f"Year: {year}")
            for (s_id, t_id), weight in reciprocal_edges_by_year[year]:
                print(f"  {s_id} <-> {t_id} with reciprocal weight {weight}")
        evolution_df.to_csv(
            f"data/institution_network_evolution_{TOPIC_NAME.replace(' ', '_')}_{START_YEAR}_{END_YEAR}.csv",
            index=False,
        )
        top_sources_by_year_df = pd.DataFrame.from_dict(
            {
                (year, s_id): details
                for year, sources in top_sources_by_year.items()
                for s_id, details in sources.items()
            },
            orient="index",
        )
        top_targets_by_year_df = pd.DataFrame.from_dict(
            {
                (year, t_id): details
                for year, targets in top_targets_by_year.items()
                for t_id, details in targets.items()
            },
            orient="index",
        )
        reciprocal_edges_by_year_df = pd.DataFrame.from_dict(
            {
                (year, (s_id, t_id)): weight
                for year, edges in reciprocal_edges_by_year.items()
                for (s_id, t_id), weight in edges
            },
            orient="index",
        )
        #score deltas is a dict with institution id as key and a tuple as value, where the tuple contains the score delta of first year and last year
        score_deltas_df = pd.DataFrame.from_dict(
            {
                inst_id: (last_year_delta, first_year_delta)
                for inst_id, (last_year_delta, first_year_delta) in score_deltas.items()
            },
            orient="index",
        )
        top_sources_by_year_df.to_csv(
            f"data/top_sources_by_year_{TOPIC_NAME.replace(' ', '_')}_{START_YEAR}_{END_YEAR}.csv"
        )
        top_targets_by_year_df.to_csv(
            f"data/top_targets_by_year_{TOPIC_NAME.replace(' ', '_')}_{START_YEAR}_{END_YEAR}.csv"
        )
        reciprocal_edges_by_year_df.to_csv(
            f"data/reciprocal_edges_by_year_{TOPIC_NAME.replace(' ', '_')}_{START_YEAR}_{END_YEAR}.csv"
        )
        score_deltas_df.to_csv(
            f"data/score_deltas_by_year_{TOPIC_NAME.replace(' ', '_')}_{START_YEAR}_{END_YEAR}.csv"
        )

    generate_geospatial_evolution(evolution_df, geo_dict, TOPIC_NAME, START_YEAR, END_YEAR, 3)

if __name__ == "__main__":
    #take topic name as argument from user
    parser = argparse.ArgumentParser(description="Build institution network evolution for a given topic.")
    parser.add_argument("--topic_name", type=str, choices=topic_dict.values(), help="Name of the topic to analyze.")
    args = parser.parse_args()
    #get topic id from topic name
    topic_id = [k for k, v in topic_dict.items() if v == args.topic_name][0]
    main(topic_id, args.topic_name)
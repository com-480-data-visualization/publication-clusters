from build_institution_network import fetch_all_years_raw_data, build_institution_geo_dict, build_edges_with_geo_dict
from preliminary_visualization import generate_geospatial_evolution
import pandas as pd
import os

#Topic_ids: T10411 = Solar Cells, T10237 = LHC
TOPIC_ID = "T10411"
TOPIC_NAME = "SolarCells"
START_YEAR, END_YEAR = 2000, 2025

if os.path.exists(f"data/institution_network_evolution_{TOPIC_NAME.replace(' ', '_')}_{START_YEAR}_{END_YEAR}.csv"):
    print("Loading existing evolution data from CSV...")
    evolution_df = pd.read_csv(f"data/institution_network_evolution_{TOPIC_NAME.replace(' ', '_')}_{START_YEAR}_{END_YEAR}.csv")
else:
    raw_data = fetch_all_years_raw_data(TOPIC_ID, start_year=START_YEAR, end_year=END_YEAR, papers_per_year=20)

    # check if data/geo_dict_{TOPIC_NAME.replace(' ', '_')}.csv exists
    if os.path.exists(f"data/geo_dict_{TOPIC_NAME.replace(' ', '_')}.csv"):
        print("Loading existing Geo Dictionary from CSV...")
        geo_dict = pd.read_csv(f"data/geo_dict_{TOPIC_NAME.replace(' ', '_')}.csv", index_col=0).to_dict(orient='index')
    else:
        print("Starting Geocoding process...")
        geo_dict = build_institution_geo_dict(raw_data)
        #save the geo_dict to a CSV for later use
        geo_df = pd.DataFrame.from_dict(geo_dict, orient='index')
        geo_df.to_csv(f"data/geo_dict_{TOPIC_NAME.replace(' ', '_')}.csv")


    print("Building the evolution network...")
    evolution_df = build_edges_with_geo_dict(raw_data, geo_dict)
    evolution_df.to_csv(f"data/institution_network_evolution_{TOPIC_NAME.replace(' ', '_')}_{START_YEAR}_{END_YEAR}.csv", index=False)

generate_geospatial_evolution(evolution_df, TOPIC_NAME, START_YEAR+5, END_YEAR, 6)
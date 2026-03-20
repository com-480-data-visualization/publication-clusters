import geopandas as gpd
import networkx as nx
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

def generate_geospatial_evolution(df, topic_name, start_year, end_year, step=1):
    """
    Generates a row of world maps showing the network evolution over time.
    Uses real-world coordinates (Lat/Lng) for node positions.
    """
    # 1. FAIL-SAFE MAP LOADING
    world = None
    # Reliable raw GeoJSON sources for a world map
    sources = [
        "https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson",
        "https://r2.datahub.io/cl79v4mky0000jw0868l6676a/master/raw/data/countries.geojson",
        "https://raw.githubusercontent.com/holtzy/The-Python-Graph-Gallery/master/static/data/world.geojson"
    ]
    
    for url in sources:
        try:
            world = gpd.read_file(url)
            print(f"Successfully loaded map from: {url}")
            break
        except Exception:
            continue
            
    if world is None:
        print("Error: Could not load any world map. Please check your internet connection.")
        return

    # 2. Setup Year Data
    years = range(start_year, end_year + 1, step)
    num_years = len(years)
    
    # Create the figure (1 row, many columns)
    fig, axes = plt.subplots(1, num_years, figsize=(6 * num_years, 7))
    if num_years == 1: axes = [axes]

    for i, year in enumerate(years):
        ax = axes[i]
        
        # Draw the Background Map
        world.plot(ax=ax, color='#ebedef', edgecolor='#ffffff', linewidth=0.5)
        
        # Filter data for the specific year
        current_df = df[df['publication_year'] == year]
        
        # 3. Build the Graph and Position Dictionary
        pos = {}
        G = nx.Graph()
        
        for _, row in current_df.iterrows():
            # Check for valid source coordinates
            if pd.notnull(row['source_lng']) and pd.notnull(row['source_lat']):
                pos[row['source_id']] = (row['source_lng'], row['source_lat'])
            
            # Check for valid target coordinates
            if pd.notnull(row['target_lng']) and pd.notnull(row['target_lat']):
                pos[row['target_id']] = (row['target_lng'], row['target_lat'])
            
            # Add edge ONLY if both nodes have coordinates
            if row['source_id'] in pos and row['target_id'] in pos:
                G.add_edge(row['source_id'], row['target_id'], weight=row['weight'])

        # 4. Draw the Network Elements
        if G.number_of_edges() > 0:
            # Draw Nodes (Institutions)
            nx.draw_networkx_nodes(
                G, pos, ax=ax, 
                node_size=25, 
                node_color='#ff4d4d', 
                alpha=0.9, 
                edgecolors='white', 
                linewidths=0.5
            )
            
            # Draw Edges (Citations)
            # Scaling width by the square root of weight for visual balance
            weights = [np.sqrt(G[u][v]['weight']) * 2.5 for u, v in G.edges()]
            nx.draw_networkx_edges(
                G, pos, ax=ax, 
                width=weights, 
                edge_color='#2c3e50', 
                alpha=0.3
            )

        # Formatting
        ax.set_title(f"{topic_name}: {year}", fontsize=18, fontweight='bold')
        
        # Set Global Bounds (WGS84 Coordinates)
        ax.set_xlim([-170, 180]) 
        ax.set_ylim([-60, 85])
        ax.axis('off')

    plt.tight_layout()
    
    # Optional: Save the figure
    # plt.savefig(f"evolution_map_{topic_name.replace(' ', '_')}.png", dpi=300, bbox_inches='tight')
    plt.savefig(f"figures/geospatial_evolution_{topic_name.replace(' ', '_')}_{start_year}_{end_year}.png", dpi=300)


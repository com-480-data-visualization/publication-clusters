import pandas as pd
import matplotlib.pyplot as plt
import networkx as nx
import numpy as np
import os

def generate_yearly_snapshots(df, topic_name):
    years = sorted(df['publication_year'].unique())
    num_years = len(years)
    
    # 1. Pre-calculate the Fixed Layout (The Map)
    G_final = nx.Graph()
    for _, row in df.iterrows():
        G_final.add_edge(row['source_id'], row['target_id'])
    
    # k controls node spacing; increase if the "bubbles" are too overlapping
    pos = nx.spring_layout(G_final, k=0.15, seed=42) 

    # 2. Create a very wide figure
    # We set width proportional to the number of years (e.g., 5 inches per year)
    fig, axes = plt.subplots(1, num_years, figsize=(5 * num_years, 6))
    
    # Handle the case where there's only 1 year (axes wouldn't be a list)
    if num_years == 1: axes = [axes]

    for i, year in enumerate(years):
        ax = axes[i]
        
        # Split Data
        current_year_df = df[df['publication_year'] == year]
        past_years_df = df[df['publication_year'] < year]
        
        # Build Background Graph (History)
        G_past = nx.Graph()
        if not past_years_df.empty:
            past_grouped = past_years_df.groupby(['source_id', 'target_id']).agg({'weight': 'sum'}).reset_index()
            for _, row in past_grouped.iterrows():
                G_past.add_edge(row['source_id'], row['target_id'], weight=row['weight'])

        # Build Active Graph (Current Year)
        G_active = nx.Graph()
        active_grouped = current_year_df.groupby(['source_id', 'target_id']).agg({'weight': 'sum'}).reset_index()
        for _, row in active_grouped.iterrows():
            G_active.add_edge(row['source_id'], row['target_id'], weight=row['weight'])

        # --- DRAWING ON THE SPECIFIC SUBPLOT (ax) ---
        
        # Draw History (Grey)
        if G_past.number_of_nodes() > 0:
            nx.draw_networkx_nodes(G_past, pos, ax=ax, node_size=10, node_color="#686868", alpha=0.2)
            past_weights = [np.sqrt(G_past[u][v]['weight']) * 1.0 for u, v in G_past.edges()]
            nx.draw_networkx_edges(G_past, pos, ax=ax, width=past_weights, edge_color='#686868', alpha=0.1)

        # Draw Active (Blue)
        if G_active.number_of_nodes() > 0:
            active_nodes = list(G_active.nodes())
            nx.draw_networkx_nodes(G_active, pos, ax=ax, nodelist=active_nodes, 
                                   node_size=40, node_color='#1f77b4', edgecolors='white', linewidths=0.5)
            active_weights = [np.sqrt(G_active[u][v]['weight']) * 2.5 for u, v in G_active.edges()]
            nx.draw_networkx_edges(G_active, pos, ax=ax, width=active_weights, edge_color='#1f77b4', alpha=0.8)

        ax.set_title(f"Year: {year}", fontsize=16, fontweight='bold')
        ax.axis('off')

    plt.tight_layout()
    if not os.path.exists("figures"):
        os.makedirs("figures")
    fig.savefig(f"figures/evolution_{topic_name.replace(' ', '_')}_2010_2025.png", dpi=300)

for data in os.listdir("data"):
    topic_name = data.split("2")[0][:-1].replace("_", " ")
    print(f"Generating snapshots for topic: {topic_name}")
    evolution_df = pd.read_csv(f"data/{data}")
    print(f"Total edges collected: {len(evolution_df)}")
    generate_yearly_snapshots(evolution_df, topic_name)
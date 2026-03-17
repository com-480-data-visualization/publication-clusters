import requests
import pandas as pd
import time
import matplotlib.pyplot as plt
import networkx as nx
import numpy as np

def fetch_openalex_data(filter_id, filter_type="topic", max_papers=100):
    base_url = "https://api.openalex.org/works"
    
    # Simpler filter syntax
    # Use 'primary_topic.id' for a specific topic or 'concepts.id' for broader fields
    if filter_type == "topic":
        api_filter = f"primary_topic.id:{filter_id}"
    else:
        # For broader fields like 'fields/17', this is the more reliable filter
        api_filter = f"topics.field.id:{filter_id}"
    
    params = {
        'filter': api_filter,
        'per_page': 50,
        'select': 'id,publication_year,authorships,referenced_works',
        'mailto': 'dedau1691@gmail.com' # Replace with your real email for the "polite pool"
    }
    
    papers = []
    cursor = "*" # Used for deep paging
    
    while len(papers) < max_papers:
        params['cursor'] = cursor
        response = requests.get(base_url, params=params)
        
        if response.status_code != 200:
            print(f"Error: {response.status_code}")
            break
            
        data = response.json()
        results = data.get('results', [])
        
        if not results:
            break
            
        papers.extend(results)
        cursor = data.get('meta', {}).get('next_cursor')
        
        if not cursor:
            break
            
        # Respect API etiquette with a small sleep
        time.sleep(0.1)
        print(f"Fetched {len(papers)} papers...")

    return papers[:max_papers]

def build_author_edges(papers_data, first_author_only=False):
    author_edges = []
    paper_to_authors = {}

    # 1. Map Paper ID to Author List (Applying the toggle here)
    for paper in papers_data:
        authorships = paper.get('authorships', [])
        
        # If the toggle is on, we only take the first element
        if first_author_only and authorships:
            authorships = [authorships[0]]
            
        authors = []
        for auth in authorships:
            # Safety check: make sure author and institution data exists
            author_id = auth.get('author', {}).get('id')
            if not author_id: continue
            
            authors.append({
                'id': author_id,
                'name': auth['author'].get('display_name', 'Unknown'),
                'country': auth['institutions'][0].get('country_code', 'Unknown') if auth.get('institutions') else "Unknown"
            })
        paper_to_authors[paper['id']] = authors

    # 2. Build the weighted edges
    for paper in papers_data:
        citing_authors = paper_to_authors.get(paper['id'], [])
        num_citing = len(citing_authors)
        
        for cited_paper_id in paper.get('referenced_works', []):
            if cited_paper_id in paper_to_authors:
                cited_authors = paper_to_authors[cited_paper_id]
                num_cited = len(cited_authors)
                
                # ZeroDivisionError Guard
                if num_citing > 0 and num_cited > 0:
                    # If using first authors only, weight is naturally 1.0 (1*1)
                    fractional_weight = 1.0 / (num_citing * num_cited)
                    
                    for c_auth in citing_authors:
                        for r_auth in cited_authors:
                            # Skip self-citations
                            if c_auth['id'] != r_auth['id']:
                                author_edges.append({
                                    'source_id': c_auth['id'],
                                    'source_name': c_auth['name'],
                                    'target_id': r_auth['id'],
                                    'target_name': r_auth['name'],
                                    'weight': fractional_weight,
                                    'publication_year': paper.get('publication_year'),
                                    'source_country': c_auth['country'],
                                    'target_country': r_auth['country']
                                })
                        
    return pd.DataFrame(author_edges)

def fetch_evolution_data(topic_id, start_year=2015, end_year=2025, papers_per_year=50):
    all_edges = []
    
    for year in range(start_year, end_year + 1):
        # The filter MUST be a single string: "primary_topic.id:T11018,publication_year:2015"
        # Note: No spaces after the comma!
        api_filter = f"primary_topic.id:{topic_id},publication_year:{year}"
        
        print(f"Requesting Year {year} with filter: {api_filter}")
        
        # Call your working fetch function
        papers = fetch_openalex_data(api_filter, max_papers=papers_per_year)
        
        if not papers:
            print(f"Warning: No papers found for year {year}")
            continue
            
        # Process into edges
        year_edges = build_author_edges(papers)
        all_edges.append(year_edges)
        
        time.sleep(0.5) 

    if not all_edges:
        return pd.DataFrame()
        
    return pd.concat(all_edges, ignore_index=True)



topics = {
    "Deep Learning": "T11018",
    "Quantum Computing": "T10231",
    "Perovskite Solar Cells": "T10115",
    "Graphene": "T10024"
}

for topic_name, topic_id in topics.items():
    print(f"Fetching data for topic: {topic_name} (ID: {topic_id})")
    evolution_df = fetch_evolution_data(topic_id, start_year=2010, end_year=2025, papers_per_year=300)
    print(f"Total edges collected: {len(evolution_df)}")
    print(evolution_df.head())
    #save to csv for later use
    evolution_df.to_csv(f"data/{topic_name.replace(' ', '_')}_2010_2025.csv", index=False)

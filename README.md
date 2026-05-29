# Publication Clusters

| Student | SCIPER | Contribution |
| ------- | ------ | ------------ |
| Melika Honarmand | 357204 | 25% |
| Aude Maier | 300671 | 25% |
| Edgar Desnos | 388960 | 25% |
| Alexandre Carel | 310350 | 25% |

**Live website:** https://com-480-data-visualization.github.io/publication-clusters/

---

## What is this?

Every time a researcher publishes a paper, they cite the work they built on. Those citations are more than footnotes, they are a map of how ideas travel across the world.

**Publication Clusters** makes that map visible. We turn twenty years of citation data into a live interactive 3D globe: each dot is a research institution, each arc is a directed citation link, and a year slider lets you watch the geography of scientific influence shift from 2005 to 2025 in real time. Hit play and watch two decades of knowledge flow animate automatically. Click any institution to explore its citation history and ranking. A live leaderboard tracks the top knowledge producers and consumers for the selected year and field.

We cover five research domains, over 25,000 institutions worldwide, and more than 3 million citation links, all navigable in real time with no backend or server.

---

## Milestones

| Milestone | Document |
| --------- | -------- |
| Milestone 1 | [milestone1.md](milestone1.md) |
| Milestone 2 | [milestone2.pdf](milestone2.pdf) |
| Milestone 3 — Process Book | [process_book.pdf](process_book.pdf) |
| Milestone 3 - Screencast | [Video](https://youtu.be/N5-NGN9ug94) |

---

## Technical Setup

### Requirements

```bash
pip install -r requirements.txt
```

The main dependencies are `requests`, `pandas`, and `geopy` for the data pipeline. The website itself has no Python dependencies — it runs entirely in the browser.

### Running the data pipeline

The pipeline fetches data from OpenAlex, geocodes institutions, and produces the CSV files served by the website.

```bash
python main.py
```

This will run the full pipeline for all five domains and write output files to `docs/data/`. The pipeline follows five stages:

1. **OpenAlex API** — fetches the top 1,000 most-cited papers per year per domain (2005–2025)
2. **Institution extraction** — identifies the lead author's institution from each paper
3. **Geocoding** — maps each institution to lat/lng using OpenAlex first, then OpenStreetMap (Nominatim) as fallback
4. **Graph construction** — builds a directed weighted citation graph between institution pairs
5. **CSV export** — writes `geo_dict_*.csv` and `institution_network_evolution_*.csv` to `docs/data/`

### Running the website locally

The website is a fully static site served from the `docs/` folder. No build step required.

```bash
cd docs
python -m http.server 8000
```

Then open http://localhost:8000 in your browser.

---

## Repository Structure

```
.
├── docs/                        # GitHub Pages — the live website
│   ├── index.html               # Main page
│   ├── app.js                   # All visualization logic (CesiumJS)
│   ├── manifest.json            # Dataset registry
│   └── data/                   # Pre-computed CSV files
│       ├── geo_dict_*.csv                       # Institution coordinates
│       ├── institution_network_evolution_*.csv   # Citation edges per year
│       ├── top_sources_by_year_*.csv             # Top knowledge consumers
│       └── top_targets_by_year_*.csv             # Top knowledge producers
├── data/                        # Local data and analysis results
│   └── results/                 # Q1, Q2, Q3 analysis outputs
├── figures/                     # Generated plots
├── build_institution_network.py # Data pipeline implementation
├── main.py                      # Pipeline entry point
├── q1_integration_analysis.ipynb
├── reciprocal_edges_results.ipynb
├── score_deltas_results.ipynb
└── requirements.txt
```

---

## Usage

Once the website is open, the interface works as follows:

- **Topic selector** — choose one of the five research domains from the dropdown
- **Year slider** — drag to select a year between 2005 and 2025
- **Play button** — animates through all years automatically
- **Click a node** — opens a side panel with the institution name, country, and citation breakdown (total, outgoing, incoming). For clusters, lists all member institutions sorted by citation weight
- **Leaderboard** — always shows the top 5 knowledge producers and top 5 consumers for the current year and domain
- **Reset camera** — flies the camera back to the data's bounding region

Nodes are coloured by whether they are individual institutions (pink) or clusters of nearby institutions (yellow). Arc width and opacity encode citation strength. Arrow heads show the direction of citation flow.

---

## Research Domains

| Domain | Topic ID |
| ------ | -------- |
| Solar Cells | T10411 |
| LHC Physics | T10237 |
| Complex Network Analysis | T10064 |
| Gravitational Waves | T10463 |
| Magnetic Thin Films | T10049 |

---

## Key Findings

**Q1 — Integration over time:** The number of countries participating in citation networks grew from around 65 to over 110 between 2005 and 2025. Over 80% of citation links cross national borders throughout the entire period. The global academic network is integrating, not fragmenting.

**Q2 — Shifting hubs:** China's research institutions shifted from net importers to major exporters across multiple fields. French institutions (CNRS, INRIA, CEA) consolidated as dominant domestic producers. Several historically prominent institutions in Europe and Japan lost ground relative to rising Asian hubs.

**Q3 — Strongest reciprocal bonds:** The most enduring bond is between Caltech (US) and the Max Planck Institute for Gravitational Physics (DE), present in all 21 years of data with a peak weight of 285 in 2021 following the LIGO detection. In Magnetic Thin Films, CNRS and CEA have appeared together for 19 consecutive years. In Complex Network Analysis, dominant pairs shifted from US-Israeli academic ties to Chinese domestic clusters by 2018.

---

## Remark

Two of our team members are also working on a project for the Computational Social Media course that involves the academic citation world. We want to be fully transparent about the boundary between these two projects.

The two projects share no code and no ideas. The datasets are entirely different. The other project studies social network attributes of the graph in the Global South versus the Global North, it is a comparison of network-level properties (centrality, community structure, connectivity) between geographic groups of the graph (in Computer Science). Our project builds institution-level geographic citation networks over time across specific research fields (Physics) to visualize how knowledge flows between labs across the planet.

The only thing the two projects have in common is a general interest in the academic citation world. Everything else, the research questions, the datasets, the methods, the visualizations, and the conclusions, is completely independent.

Cesium.Ion.defaultAccessToken =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJkMWEzMjcyZi0yODY0LTQxYzctODY3NC00OTk2NmQzNDhlN2QiLCJpZCI6NDE3NjM4LCJpYXQiOjE3NzY0MTczODl9.aDksDwuepiqb2mEkFHFIyHwIdbRqqUim9wvX4A-mg7o";

// --------------------------------------------------
// Cesium viewer
// --------------------------------------------------

const viewer = new Cesium.Viewer("cesiumContainer", {
    terrain: Cesium.Terrain.fromWorldTerrain(),

    requestRenderMode: true,
    maximumRenderTimeChange: Infinity,

    // Cleaner, more custom-looking interface
    animation: false,
    timeline: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    baseLayerPicker: false,
    navigationHelpButton: false,
    fullscreenButton: false,
    infoBox: false,
    selectionIndicator: false,
});

viewer.scene.globe.depthTestAgainstTerrain = true;
viewer.scene.globe.enableLighting = false;
viewer.scene.skyAtmosphere.show = true;
viewer.scene.fog.enabled = true;
viewer.scene.highDynamicRange = true;

// A slightly more cinematic starting view before data loads
const INITIAL_CAMERA_VIEW = {
    destination: Cesium.Cartesian3.fromDegrees(8, 30, 24_000_000),
    orientation: {
        heading: 0,
        pitch: -1.35,
        roll: 0,
    },
};

// A slightly more cinematic starting view before data loads
viewer.camera.setView(INITIAL_CAMERA_VIEW);

const pointDataSource = new Cesium.CustomDataSource("superpoints");
const edgeDataSource = new Cesium.CustomDataSource("superedges");

viewer.dataSources.add(edgeDataSource);
viewer.dataSources.add(pointDataSource);

// --------------------------------------------------
// State
// --------------------------------------------------

const datasets = {};
const geoByDataset = {};
const graphCache = {};
const datasetLabels = {};
const topSourcesByDataset = {};
const topTargetsByDataset = {};

let datasetManifest = [];
let datasetConfigById = new Map();

const loadedDatasets = new Set();
const datasetLoadingPromises = new Map();

let currentDataset = null;
let lastRefreshKey = null;
let hasInitialZoomed = false;
let appStarted = false;

const HIDE_SELF_LOOPS = true;
const DIRECTED_EDGES = true;

// --------------------------------------------------
// DOM elements
// --------------------------------------------------

const yearSlider = document.getElementById("yearSlider");
const yearValue = document.getElementById("yearValue");
const datasetSelect = document.getElementById("datasetSelect");
const resetCameraButton = document.getElementById("resetCameraButton");

const introOverlay = document.getElementById("introOverlay");
const startGlobeButton = document.getElementById("startGlobeButton");

const nodeCountEl = document.getElementById("nodeCount");
const edgeCountEl = document.getElementById("edgeCount");
const clusterCountEl = document.getElementById("clusterCount");
const visibleEdgeCountEl = document.getElementById("visibleEdgeCount");
const statusMessage = document.getElementById("statusMessage");
const topProducersList = document.getElementById("topProducersList");
const topConsumersList = document.getElementById("topConsumersList");

let currentSuperpointsById = new Map();
let selectedInstitutionId = null;

const infoPanel = document.getElementById("infoPanel");
const infoPanelClose = document.getElementById("infoPanelClose");
const infoPanelType = document.getElementById("infoPanelType");
const infoPanelTitle = document.getElementById("infoPanelTitle");
const infoPanelSubtitle = document.getElementById("infoPanelSubtitle");
const infoPanelStats = document.getElementById("infoPanelStats");
const infoPanelMembersWrap = document.getElementById("infoPanelMembersWrap");
const infoPanelMembers = document.getElementById("infoPanelMembers");

//
// Manifest Helpers
//

async function loadManifest(path = "./manifest.json") {
    const response = await fetch(path);

    if (!response.ok) {
        throw new Error(`Failed to load manifest: ${response.status} ${response.statusText}`);
    }

    const manifest = await response.json();

    if (!Array.isArray(manifest.datasets) || manifest.datasets.length === 0) {
        throw new Error("manifest.json must contain a non-empty datasets array.");
    }

    return manifest;
}

function registerDatasetsFromManifest(manifest) {
    datasetManifest = manifest.datasets;
    datasetConfigById = new Map();

    for (const dataset of datasetManifest) {
        if (!dataset.id) {
            throw new Error("Every dataset in manifest.json needs an id.");
        }

        if (!dataset.network || !dataset.geo) {
            throw new Error(`Dataset "${dataset.id}" needs both network and geo CSV paths.`);
        }

        datasetConfigById.set(dataset.id, dataset);

        datasets[dataset.id] = [];
        geoByDataset[dataset.id] = new Map();
        graphCache[dataset.id] = new Map();
        topSourcesByDataset[dataset.id] = [];
        topTargetsByDataset[dataset.id] = [];
        datasetLabels[dataset.id] = dataset.label ?? dataset.id;
    }

    currentDataset =
        manifest.defaultDataset && datasetConfigById.has(manifest.defaultDataset)
            ? manifest.defaultDataset
            : datasetManifest[0].id;
}

function populateDatasetSelect() {
    datasetSelect.innerHTML = "";

    for (const dataset of datasetManifest) {
        const option = document.createElement("option");
        option.value = dataset.id;
        option.textContent = dataset.label ?? dataset.id;

        datasetSelect.appendChild(option);
    }

    datasetSelect.value = currentDataset;
}

// --------------------------------------------------
// CSV loading
// --------------------------------------------------

function loadCSV(path) {
    return new Promise((resolve, reject) => {
        Papa.parse(path, {
            download: true,
            header: true,
            dynamicTyping: true,
            skipEmptyLines: true,
            complete(results) {
                resolve(results.data);
            },
            error(error) {
                reject(error);
            },
        });
    });
}

function cleanId(value) {
    return value === undefined || value === null ? "" : String(value).trim();
}

function getGeoId(row) {
    return cleanId(
        row.id ??
        row.institution_id ??
        row.openalex_id ??
        row["Unnamed: 0"] ??
        row[""]
    );
}

function buildGeoMap(rows) {
    const geoMap = new Map();

    for (const row of rows) {
        const id = getGeoId(row);
        const lat = toNumber(row.lat);
        const lon = toNumber(row.lng ?? row.lon ?? row.longitude);

        if (!id || lat === null || lon === null) continue;

        geoMap.set(id, {
            id,
            name: row.name ?? id,
            country: row.country ?? "",
            lat,
            lon,
        });
    }

    return geoMap;
}

async function loadDataset(datasetConfig) {
    const [networkRows, geoRows, topSourcesRows, topTargetsRows] = await Promise.all([
        loadCSV(datasetConfig.network),
        loadCSV(datasetConfig.geo),
        datasetConfig.topSources ? loadCSV(datasetConfig.topSources) : Promise.resolve([]),
        datasetConfig.topTargets ? loadCSV(datasetConfig.topTargets) : Promise.resolve([]),
    ]);

    datasets[datasetConfig.id] = networkRows;
    geoByDataset[datasetConfig.id] = buildGeoMap(geoRows);
    topSourcesByDataset[datasetConfig.id] = topSourcesRows;
    topTargetsByDataset[datasetConfig.id] = topTargetsRows;

    buildGraphCacheForDataset(datasetConfig.id);

    loadedDatasets.add(datasetConfig.id);
}

async function ensureDatasetLoaded(datasetId) {
    if (loadedDatasets.has(datasetId)) {
        return;
    }

    if (datasetLoadingPromises.has(datasetId)) {
        return datasetLoadingPromises.get(datasetId);
    }

    const datasetConfig = datasetConfigById.get(datasetId);

    if (!datasetConfig) {
        throw new Error(`Unknown dataset: ${datasetId}`);
    }

    setStatus(`Loading ${datasetLabels[datasetId]} data…`);

    const loadingPromise = loadDataset(datasetConfig)
        .then(() => {
            setStatus(`${datasetLabels[datasetId]} loaded.`);
        })
        .catch((error) => {
            console.error(`Failed to load dataset "${datasetId}":`, error);
            setStatus(`Failed to load ${datasetLabels[datasetId]} data.`, true);
            throw error;
        })
        .finally(() => {
            datasetLoadingPromises.delete(datasetId);
        });

    datasetLoadingPromises.set(datasetId, loadingPromise);

    return loadingPromise;
}

setStatus("Preparing visualization…");

loadManifest("./manifest.json")
    .then((manifest) => {
        registerDatasetsFromManifest(manifest);
        populateDatasetSelect();

        setStatus("Choose a topic, then start exploring.");
    })
    .catch((error) => {
        console.error("Startup failed:", error);
        setStatus("Failed to load manifest.", true);
    });

// --------------------------------------------------
// Helpers
// --------------------------------------------------

function setStatus(message, isError = false) {
    statusMessage.textContent = message;
    statusMessage.classList.toggle("error", isError);
}

function formatNumber(value) {
    return new Intl.NumberFormat("en").format(value ?? 0);
}

function getTopRowYear(row) {
    return Number(row.publication_year ?? row.year ?? Object.values(row)[0]);
}

function getTopRowInstitutionId(row) {
    return cleanId(
        row.institution_id ??
        row.source_id ??
        row.target_id ??
        row.id ??
        Object.values(row)[1]
    );
}

function getTopRowCount(row, mode) {
    const key =
        mode === "source"
            ? "source_frequency_this_year"
            : "target_frequency_this_year";

    return toNumber(row[key] ?? row.count ?? row.frequency ?? Object.values(row)[2]) ?? 0;
}

function renderLeaderboardList(element, rows, year, mode) {
    const geoMap = geoByDataset[currentDataset];

    const topRows = rows
        .filter((row) => getTopRowYear(row) === year)
        .slice(0, 5);

    element.innerHTML = "";

    if (!topRows.length) {
        element.innerHTML = "<li>No leaderboard data for this year.</li>";
        return;
    }

    for (const row of topRows) {
        const institutionId = getTopRowInstitutionId(row);
        const geo = geoMap.get(institutionId);
        const name = geo?.name ?? institutionId;
        const country = geo?.country ? `, ${geo.country}` : "";
        const count = getTopRowCount(row, mode);

        const li = document.createElement("li");
        li.innerHTML = `
            <strong>${name}</strong>
            <span>${country} · ${formatNumber(count)} citations</span>
        `;

        element.appendChild(li);
    }
}

function updateLeaderboards(year) {
    renderLeaderboardList(
        topProducersList,
        topSourcesByDataset[currentDataset] ?? [],
        year,
        "source"
    );

    renderLeaderboardList(
        topConsumersList,
        topTargetsByDataset[currentDataset] ?? [],
        year,
        "target"
    );
}

function getYears(data) {
    return data
        .map((row) => Number(row.publication_year))
        .filter((year) => Number.isFinite(year));
}

function toNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function makePosition(lon, lat, height = 160_000) {
    return Cesium.Cartesian3.fromDegrees(lon, lat, height);
}

function edgeKey(a, b, directed = false) {
    if (directed) return `${a}__${b}`;
    return a < b ? `${a}__${b}` : `${b}__${a}`;
}

function debounce(fn, delay) {
    let timeoutId = null;

    return function (...args) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => fn.apply(this, args), delay);
    };
}

function getCameraHeight() {
    return viewer.camera.positionCartographic.height;
}

// More clustering when zoomed out
function getClusterCellSizeDegrees() {
    const height = getCameraHeight();

    if (height > 20_000_000) return 45;
    if (height > 10_000_000) return 30;
    if (height > 5_000_000) return 18;
    if (height > 2_000_000) return 10;
    if (height > 1_000_000) return 5;
    if (height > 500_000) return 2;
    return 1;
}

function getZoomBucket() {
    const height = getCameraHeight();

    if (height > 20_000_000) return 6;
    if (height > 10_000_000) return 5;
    if (height > 5_000_000) return 4;
    if (height > 2_000_000) return 3;
    if (height > 1_000_000) return 2;
    if (height > 500_000) return 1;
    return 0;
}

function getRefreshKey(year) {
    return `${currentDataset}|${year}|${getZoomBucket()}`;
}

// --------------------------------------------------
// Build raw graph once per year
// --------------------------------------------------

function addNodeFromGeo(nodeMap, id, geo) {
    if (!id || !geo) return;

    if (!nodeMap.has(id)) {
        nodeMap.set(id, {
            id,
            name: geo.name ?? id,
            country: geo.country ?? "",
            lon: geo.lon,
            lat: geo.lat,
            incomingWeight: 0,
            outgoingWeight: 0,
            totalWeight: 0,
        });
    }
}

function buildGraphForYear(data, geoMap, year) {
    const rows = data.filter((row) => Number(row.publication_year) === year);

    const nodeMap = new Map();
    const edges = [];
    let skippedMissingGeo = 0;

    for (const row of rows) {
        const sourceId = cleanId(row.source_id);
        const targetId = cleanId(row.target_id);

        const sourceGeo = geoMap.get(sourceId);
        const targetGeo = geoMap.get(targetId);

        if (!sourceGeo || !targetGeo) {
            skippedMissingGeo += 1;
            continue;
        }

        addNodeFromGeo(nodeMap, sourceId, sourceGeo);
        addNodeFromGeo(nodeMap, targetId, targetGeo);

        const weight = toNumber(row.weight) ?? 1;

        const sourceNode = nodeMap.get(sourceId);
        const targetNode = nodeMap.get(targetId);

        sourceNode.outgoingWeight += weight;
        sourceNode.totalWeight += weight;

        targetNode.incomingWeight += weight;
        targetNode.totalWeight += weight;

        edges.push({
            source: sourceId,
            target: targetId,
            weight,
            row,
        });
    }

    return {
        nodes: Array.from(nodeMap.values()),
        edges,
        skippedMissingGeo,
    };
}

function buildGraphCacheForDataset(datasetKey) {
    const data = datasets[datasetKey];
    const geoMap = geoByDataset[datasetKey];
    const years = [...new Set(getYears(data))];

    graphCache[datasetKey].clear();

    for (const year of years) {
        graphCache[datasetKey].set(
            year,
            buildGraphForYear(data, geoMap, year)
        );
    }
}

// --------------------------------------------------
// Camera helpers
// --------------------------------------------------

function zoomToGraph(graph) {
    if (!graph || !graph.nodes.length) return;

    const positions = graph.nodes.map((node) => makePosition(node.lon, node.lat));
    const boundingSphere = Cesium.BoundingSphere.fromPoints(positions);

    viewer.camera.flyToBoundingSphere(boundingSphere, {
        duration: 1.5,
        offset: new Cesium.HeadingPitchRange(
            0,
            -1.2,
            Math.max(boundingSphere.radius * 2.5, 2_000_000)
        ),
    });
}

function resetCamera() {
    const year = Number(yearSlider.value);
    const graph = graphCache[currentDataset]?.get(year);

    if (graph && graph.nodes.length) {
        zoomToGraph(graph);
    } else {
        viewer.camera.flyTo({
            ...INITIAL_CAMERA_VIEW,
            duration: 1.5,
        });
    }

    viewer.scene.requestRender();
}

// --------------------------------------------------
// World-space clustering
// --------------------------------------------------

function computeSuperpoints(nodes, cellSizeDeg) {
    const buckets = new Map();
    const nodeToSuperpoint = new Map();
    const normalizedCellSize = Math.max(cellSizeDeg, 0.0001);

    for (const node of nodes) {
        const cellLon = Math.floor((node.lon + 180) / normalizedCellSize);
        const cellLat = Math.floor((node.lat + 90) / normalizedCellSize);
        const key = `${cellLon}_${cellLat}`;

        if (!buckets.has(key)) {
            buckets.set(key, []);
        }

        buckets.get(key).push(node);
    }

    const superpoints = [];
    let index = 0;

    for (const members of buckets.values()) {
        let lonSum = 0;
        let latSum = 0;

        for (const member of members) {
            lonSum += member.lon;
            latSum += member.lat;
        }

        const count = members.length;
        const superId = `sp_${index++}`;

        const totalWeight = members.reduce(
            (sum, member) => sum + (member.totalWeight ?? 0),
            0
        );

        const incomingWeight = members.reduce(
            (sum, member) => sum + (member.incomingWeight ?? 0),
            0
        );

        const outgoingWeight = members.reduce(
            (sum, member) => sum + (member.outgoingWeight ?? 0),
            0
        );

        const superpoint = {
            id: superId,
            lon: lonSum / count,
            lat: latSum / count,
            count,
            totalWeight,
            incomingWeight,
            outgoingWeight,
            members,
        };

        superpoints.push(superpoint);

        for (const member of members) {
            nodeToSuperpoint.set(member.id, superId);
        }
    }

    return {
        superpoints,
        nodeToSuperpoint,
    };
}

// --------------------------------------------------
// Aggregate raw edges into super-edges
// --------------------------------------------------

function aggregateEdges(rawEdges, nodeToSuperpoint, directed = DIRECTED_EDGES) {
    const superEdgeMap = new Map();

    for (const edge of rawEdges) {
        const sourceSuper = nodeToSuperpoint.get(edge.source);
        const targetSuper = nodeToSuperpoint.get(edge.target);

        if (!sourceSuper || !targetSuper) continue;
        if (HIDE_SELF_LOOPS && sourceSuper === targetSuper) continue;

        const key = edgeKey(sourceSuper, targetSuper, directed);

        if (!superEdgeMap.has(key)) {
            superEdgeMap.set(key, {
                key,
                sourceSuper: directed
                    ? sourceSuper
                    : sourceSuper < targetSuper
                        ? sourceSuper
                        : targetSuper,
                targetSuper: directed
                    ? targetSuper
                    : sourceSuper < targetSuper
                        ? targetSuper
                        : sourceSuper,
                weight: 0,
                edgeCount: 0,
            });
        }

        const item = superEdgeMap.get(key);
        item.weight += edge.weight ?? 1;
        item.edgeCount += 1;
    }

    return Array.from(superEdgeMap.values());
}

// --------------------------------------------------
// Styling
// --------------------------------------------------

function getSuperpointPixelSize(superpoint) {
    const volume = superpoint.totalWeight ?? 0;
    const clusterBoost = Math.sqrt(superpoint.count ?? 1) * 2;

    return Math.min(60, 8 + Math.sqrt(volume) * 1.25 + clusterBoost);
}

function getEdgeWidth(weight) {
    if (weight <= 1) return 2.2;
    return Math.min(16, 2.2 + Math.sqrt(weight) * 1.55);
}

function getLabelFont(count) {
    if (count < 10) return "700 13px Inter, sans-serif";
    if (count < 100) return "800 15px Inter, sans-serif";
    if (count < 1000) return "800 17px Inter, sans-serif";
    return "800 19px Inter, sans-serif";
}

function getNodeColor(count) {
    return count > 1
        ? Cesium.Color.fromCssColorString("#fbbf24")
        : Cesium.Color.fromCssColorString("#fb7185");
}

function getNodeOutlineColor() {
    return Cesium.Color.fromCssColorString("#f8fafc");
}

function getEdgeColor(weight) {
    const alpha = Math.min(0.82, 0.38 + Math.sqrt(weight) * 0.06);
    return Cesium.Color.fromCssColorString("#38bdf8").withAlpha(alpha);
}

// --------------------------------------------------
// Rendering
// --------------------------------------------------

function renderSuperpoints(superpoints) {
    pointDataSource.entities.removeAll();

    for (const superpoint of superpoints) {
        const isCluster = superpoint.count > 1;
        const pixelSize = getSuperpointPixelSize(superpoint);

        pointDataSource.entities.add({
            id: superpoint.id,
            position: makePosition(superpoint.lon, superpoint.lat),

            point: {
                pixelSize,
                color: getNodeColor(superpoint.count),
                outlineColor: getNodeOutlineColor(),
                outlineWidth: isCluster ? 2.4 : 1.8,

                // Important: let the globe hide points on the far side.
                disableDepthTestDistance: 0,

                // Optional: make front-side nodes fully solid.
                translucencyByDistance: new Cesium.NearFarScalar(
                    500_000,
                    1.0,
                    25_000_000,
                    1.0
                ),

                scaleByDistance: new Cesium.NearFarScalar(
                    500_000,
                    1.0,
                    25_000_000,
                    0.82
                ),
            },

            label: isCluster
                ? {
                    text: String(superpoint.count),
                    font: getLabelFont(superpoint.count),
                    fillColor: Cesium.Color.fromCssColorString("#020617"),
                    outlineColor: Cesium.Color.fromCssColorString("#ffffff"),
                    outlineWidth: 2,
                    style: Cesium.LabelStyle.FILL_AND_OUTLINE,

                    verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                    horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
                    pixelOffset: new Cesium.Cartesian2(0, -(pixelSize * 0.72)),

                    showBackground: true,
                    backgroundColor: Cesium.Color.fromCssColorString("#f8fafc").withAlpha(0.86),
                    backgroundPadding: new Cesium.Cartesian2(7, 4),

                    disableDepthTestDistance: 0,
                    scale: 1.0,
                }
                : undefined,

            description: `
                <strong>${superpoint.count} institution${superpoint.count === 1 ? "" : "s"}</strong><br/>
                Total citation volume: ${formatNumber(superpoint.totalWeight)}<br/>
                Outgoing citations: ${formatNumber(superpoint.outgoingWeight)}<br/>
                Incoming citations: ${formatNumber(superpoint.incomingWeight)}
            `,

            properties: {
                type: "superpoint",
                count: superpoint.count,
                totalWeight: superpoint.totalWeight,
                incomingWeight: superpoint.incomingWeight,
                outgoingWeight: superpoint.outgoingWeight,
                members: superpoint.members,
            },
        });
    }
}

function renderSuperEdges(superpoints, superEdges) {
    edgeDataSource.entities.removeAll();

    const superpointById = new Map(superpoints.map((superpoint) => [superpoint.id, superpoint]));

    for (const edge of superEdges) {
        const source = superpointById.get(edge.sourceSuper);
        const target = superpointById.get(edge.targetSuper);

        if (!source || !target) continue;

        edgeDataSource.entities.add({
            polyline: {
                positions: [
                    makePosition(source.lon, source.lat, 20_000),
                    makePosition(target.lon, target.lat, 20_000),
                ],
                width: getEdgeWidth(edge.weight),
                material: new Cesium.PolylineArrowMaterialProperty(
                    getEdgeColor(edge.weight)
                ),
                clampToGround: false,
                arcType: Cesium.ArcType.GEODESIC,
            },

            description: `
                <strong>Directed citation flow</strong><br/>
                Citation volume: ${formatNumber(edge.weight)}<br/>
                Institution-pair links: ${formatNumber(edge.edgeCount)}
            `,

            properties: {
                type: "superedge",
                weight: edge.weight,
                edgeCount: edge.edgeCount,
                sourceSuper: edge.sourceSuper,
                targetSuper: edge.targetSuper,
            },
        });
    }
}

function updateStats(graph, superpoints, superEdges) {
    nodeCountEl.textContent = formatNumber(graph?.nodes.length ?? 0);
    edgeCountEl.textContent = formatNumber(graph?.edges.length ?? 0);
    clusterCountEl.textContent = formatNumber(superpoints?.length ?? 0);
    visibleEdgeCountEl.textContent = formatNumber(superEdges?.length ?? 0);
}

// --------------------------------------------------
// Main refresh
// --------------------------------------------------

function refreshGraph(year, options = {}) {
    const { zoom = false, force = false } = options;

    const key = getRefreshKey(year);
    if (!force && key === lastRefreshKey) {
        return;
    }

    lastRefreshKey = key;

    const graph = graphCache[currentDataset].get(year);

    pointDataSource.entities.removeAll();
    edgeDataSource.entities.removeAll();

    if (!graph || !graph.nodes.length) {
        yearValue.textContent = year;
        updateStats(null, [], []);
        updateLeaderboards(year);
        setStatus(`No data found for ${datasetLabels[currentDataset]} in ${year}.`);
        viewer.scene.requestRender();
        return;
    }

    if (zoom) {
        zoomToGraph(graph);
    }

    const cellSizeDeg = getClusterCellSizeDegrees();
    const { superpoints, nodeToSuperpoint } = computeSuperpoints(graph.nodes, cellSizeDeg);
    const superEdges = aggregateEdges(graph.edges, nodeToSuperpoint, DIRECTED_EDGES);

    currentSuperpointsById = new Map(superpoints.map((sp) => [sp.id, sp]));

    if (selectedInstitutionId) {
        const containing = superpoints.find((sp) =>
            sp.members.some((m) => m.id === selectedInstitutionId)
        );
        if (containing) {
            showInfoForSuperpoint(containing, { preserveInstitutionId: true });
        } else {
            hideInfoPanel();
        }
    } else if (!infoPanel.hidden) {
        hideInfoPanel();
    }

    renderSuperEdges(superpoints, superEdges);
    renderSuperpoints(superpoints);

    yearValue.textContent = year;
    updateStats(graph, superpoints, superEdges);
    updateLeaderboards(year);

    setStatus(
        `${datasetLabels[currentDataset]} · ${year} · clustering cell size ${cellSizeDeg}°`
    );

    console.log({
        dataset: datasetLabels[currentDataset],
        year,
        rawNodes: graph.nodes.length,
        rawEdges: graph.edges.length,
        cellSizeDeg,
        superpoints: superpoints.length,
        superedges: superEdges.length,
    });

    viewer.scene.requestRender();
}

// --------------------------------------------------
// UI
// --------------------------------------------------

function updateSliderRange() {
    const data = datasets[currentDataset];
    const years = getYears(data);

    if (!years.length) {
        yearSlider.min = 0;
        yearSlider.max = 0;
        yearSlider.value = 0;
        yearValue.textContent = "—";
        updateStats(null, [], []);
        return;
    }

    // Do not use Math.min(...years) / Math.max(...years) on large CSVs.
    let minYear = years[0];
    let maxYear = years[0];

    for (const year of years) {
        if (year < minYear) minYear = year;
        if (year > maxYear) maxYear = year;
    }

    yearSlider.min = minYear;
    yearSlider.max = maxYear;
    yearSlider.step = 1;
    yearSlider.value = minYear;
    yearValue.textContent = minYear;

    const datalist = document.getElementById("yearTicks");
    datalist.innerHTML = "";
    for (let y = minYear; y <= maxYear; y++) {
        if (y === minYear || y === maxYear || y % 5 === 0) {
            const opt = document.createElement("option");
            opt.value = y;
            opt.label = String(y);
            datalist.appendChild(opt);
        }
    }
}

function showYear(year, options = {}) {
    refreshGraph(year, options);
}

async function initUI() {
    await ensureDatasetLoaded(currentDataset);

    updateSliderRange();

    showYear(Number(yearSlider.value), {
        zoom: true,
        force: true,
    });

    hasInitialZoomed = true;
}

yearSlider.addEventListener("input", function () {
    if (!loadedDatasets.has(currentDataset)) return;

    const selectedYear = Number(this.value);
    yearValue.textContent = selectedYear;

    showYear(selectedYear, {
        force: true,
    });
});

datasetSelect.addEventListener("change", async function () {
    const previousYear = Number(yearSlider.value);
    currentDataset = this.value;
    lastRefreshKey = null;
    hasInitialZoomed = false;

    pointDataSource.entities.removeAll();
    edgeDataSource.entities.removeAll();
    updateStats(null, [], []);
    yearValue.textContent = "—";

    try {
        await ensureDatasetLoaded(currentDataset);

        updateSliderRange();

        const min = Number(yearSlider.min);
        const max = Number(yearSlider.max);

        if (
            Number.isFinite(previousYear) &&
            previousYear >= min &&
            previousYear <= max
        ) {
            yearSlider.value = previousYear;
            yearValue.textContent = previousYear;
        }

        showYear(Number(yearSlider.value), {
            zoom: true,
            force: true,
        });
    } catch (error) {
        console.error(error);
        setStatus(`Failed to load ${datasetLabels[currentDataset]} data.`, true);
    }
});

resetCameraButton.addEventListener("click", resetCamera);

if (introOverlay && startGlobeButton) {
    startGlobeButton.addEventListener("click", async () => {
        if (appStarted) return;

        appStarted = true;
        startGlobeButton.disabled = true;
        startGlobeButton.textContent = "Loading globe…";

        // Hide the overlay first so the click feels immediate.
        introOverlay.classList.add("is-hidden");
        viewer.scene.requestRender();

        // Give the browser one frame to paint the fade-out before loading CSVs.
        await new Promise((resolve) => requestAnimationFrame(resolve));

        try {
            await initUI();
            setStatus("Ready.");
        } catch (error) {
            console.error(error);
            setStatus("Failed to start visualization.", true);

            // Bring the overlay back if loading fails.
            introOverlay.classList.remove("is-hidden");
            startGlobeButton.disabled = false;
            startGlobeButton.textContent = "Try again";
            appStarted = false;
        }
    });
} else {
    console.warn("Intro overlay or start button was not found.");
}

viewer.camera.moveEnd.addEventListener(
    debounce(() => {
        if (!hasInitialZoomed) return;
        showYear(Number(yearSlider.value));
    }, 120)
);

const playButton = document.getElementById("playButton");
let playInterval = null;

playButton.addEventListener("click", () => {
    if (playInterval) {
        clearInterval(playInterval);
        playInterval = null;
        playButton.querySelector(".reset-camera-icon").textContent = "▶";
        playButton.querySelector(".play-label").textContent = "Play";
        return;
    }
    playInterval = setInterval(() => {
        const cur = Number(yearSlider.value);
        const max = Number(yearSlider.max);
        yearSlider.value = cur >= max ? Number(yearSlider.min) : cur + 1;
        yearSlider.dispatchEvent(new Event("input"));
    }, 900);
    playButton.querySelector(".reset-camera-icon").textContent = "⏸";
    playButton.querySelector(".play-label").textContent = "Pause";
});

//
// Click-to-inspect node details
//

function makeStat(value, label) {
    return `
    <div class="stat">
      <span class="stat-value">${value}</span>
      <span class="stat-label">${label}</span>
    </div>
  `;
}

function showInfoForSuperpoint(superpoint, options = {}) {
    const { preserveInstitutionId = false } = options;
    const isCluster = superpoint.count > 1;

    if (isCluster) {
        infoPanelType.textContent = `Cluster · ${superpoint.count} institutions`;
        infoPanelTitle.textContent = `${superpoint.count} institutions`;

        const countries = [
            ...new Set(superpoint.members.map((m) => m.country).filter(Boolean)),
        ];
        const countryLabel =
            countries.length === 0
                ? ""
                : countries.length === 1
                    ? countries[0]
                    : `${countries.length} countries`;

        infoPanelSubtitle.textContent =
            `${countryLabel}${countryLabel ? " · " : ""}zoom in to break the cluster apart`;

        infoPanelStats.innerHTML = [
            makeStat(formatNumber(superpoint.totalWeight), "Total citations"),
            makeStat(formatNumber(superpoint.outgoingWeight), "Outgoing"),
            makeStat(formatNumber(superpoint.incomingWeight), "Incoming"),
            makeStat(formatNumber(superpoint.count), "Institutions"),
        ].join("");

        const sorted = [...superpoint.members].sort(
            (a, b) => (b.totalWeight ?? 0) - (a.totalWeight ?? 0)
        );

        infoPanelMembers.innerHTML = sorted
            .map(
                (m) => `
          <li>
            <strong>${m.name}</strong>
            <span>
              ${m.country ? m.country + " · " : ""}
              ${formatNumber(m.totalWeight)} citations
              (${formatNumber(m.outgoingWeight)} out,
               ${formatNumber(m.incomingWeight)} in)
            </span>
          </li>
        `
            )
            .join("");

        infoPanelMembersWrap.hidden = false;

        if (!preserveInstitutionId) {
            selectedInstitutionId = null;
        }
    } else {
        const inst = superpoint.members[0];
        infoPanelType.textContent = "Institution";
        infoPanelTitle.textContent = inst.name;
        infoPanelSubtitle.textContent = inst.country || "";

        infoPanelStats.innerHTML = [
            makeStat(formatNumber(inst.totalWeight), "Total citations"),
            makeStat(formatNumber(inst.outgoingWeight), "Outgoing"),
            makeStat(formatNumber(inst.incomingWeight), "Incoming"),
        ].join("");

        infoPanelMembersWrap.hidden = true;
        selectedInstitutionId = inst.id;
    }

    infoPanel.hidden = false;
}

function hideInfoPanel() {
    infoPanel.hidden = true;
    selectedInstitutionId = null;
}

infoPanelClose.addEventListener("click", hideInfoPanel);

const clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

clickHandler.setInputAction((click) => {
    const picked = viewer.scene.pick(click.position);

    if (Cesium.defined(picked) && picked.id && picked.id.properties) {
        const type = picked.id.properties.type?.getValue?.();

        if (type === "superpoint") {
            const superpoint = currentSuperpointsById.get(picked.id.id);
            if (superpoint) showInfoForSuperpoint(superpoint);
            return;
        }

        return;
    }

    hideInfoPanel();
}, Cesium.ScreenSpaceEventType.LEFT_CLICK);
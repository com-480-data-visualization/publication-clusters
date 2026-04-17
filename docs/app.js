Cesium.Ion.defaultAccessToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJkMWEzMjcyZi0yODY0LTQxYzctODY3NC00OTk2NmQzNDhlN2QiLCJpZCI6NDE3NjM4LCJpYXQiOjE3NzY0MTczODl9.aDksDwuepiqb2mEkFHFIyHwIdbRqqUim9wvX4A-mg7o";

const viewer = new Cesium.Viewer("cesiumContainer", {
    terrain: Cesium.Terrain.fromWorldTerrain(),
    requestRenderMode: true,
    maximumRenderTimeChange: Infinity,
});

viewer.scene.globe.depthTestAgainstTerrain = false;

const pointDataSource = new Cesium.CustomDataSource("superpoints");
const edgeDataSource = new Cesium.CustomDataSource("superedges");

viewer.dataSources.add(edgeDataSource);
viewer.dataSources.add(pointDataSource);

let datasets = {
    A: [],
    B: []
};

const graphCache = {
    A: new Map(),
    B: new Map()
};

let currentDataset = "A";
let lastRefreshKey = null;
let hasInitialZoomed = false;

const yearSlider = document.getElementById("yearSlider");
const yearValue = document.getElementById("yearValue");
const datasetSelect = document.getElementById("datasetSelect");

const HIDE_SELF_LOOPS = true;
const DIRECTED_EDGES = false;

// --------------------------------------------------
// CSV loading
// --------------------------------------------------

function loadCSV(path, key) {
    return new Promise((resolve) => {
        Papa.parse(path, {
            download: true,
            header: true,
            dynamicTyping: true,
            skipEmptyLines: true,
            complete: function (results) {
                datasets[key] = results.data;
                resolve();
            }
        });
    });
}

Promise.all([
    loadCSV("./data/institution_network_evolution_LHC_2000_2025.csv", "A"),
    loadCSV("./data/institution_network_evolution_SolarCells_2000_2025.csv", "B")
]).then(() => {
    buildGraphCacheForDataset("A");
    buildGraphCacheForDataset("B");
    initUI();
});

// --------------------------------------------------
// Helpers
// --------------------------------------------------

function getYears(data) {
    return data
        .map(row => Number(row.publication_year))
        .filter(y => Number.isFinite(y));
}

function toNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function makePosition(lon, lat) {
    return Cesium.Cartesian3.fromDegrees(lon, lat, 0);
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
    const h = getCameraHeight();

    if (h > 20_000_000) return 45;
    if (h > 10_000_000) return 30;
    if (h > 5_000_000) return 18;
    if (h > 2_000_000) return 10;
    if (h > 1_000_000) return 5;
    if (h > 500_000) return 2;
    return 1;
}

function getZoomBucket() {
    const h = getCameraHeight();

    if (h > 20_000_000) return 6;
    if (h > 10_000_000) return 5;
    if (h > 5_000_000) return 4;
    if (h > 2_000_000) return 3;
    if (h > 1_000_000) return 2;
    if (h > 500_000) return 1;
    return 0;
}

function getRefreshKey(year) {
    return `${currentDataset}|${year}|${getZoomBucket()}`;
}

// --------------------------------------------------
// Build raw graph once per year
// --------------------------------------------------

function buildGraphForYear(data, year) {
    const rows = data.filter(row => Number(row.publication_year) === year);

    const nodeMap = new Map();
    const edges = [];

    for (const row of rows) {
        const sId = row.source_id;
        const tId = row.target_id;

        const sLon = toNumber(row.source_lng);
        const sLat = toNumber(row.source_lat);
        const tLon = toNumber(row.target_lng);
        const tLat = toNumber(row.target_lat);

        const sourceValid = !!sId && sLon !== null && sLat !== null;
        const targetValid = !!tId && tLon !== null && tLat !== null;

        if (sourceValid && !nodeMap.has(sId)) {
            nodeMap.set(sId, {
                id: sId,
                lon: sLon,
                lat: sLat
            });
        }

        if (targetValid && !nodeMap.has(tId)) {
            nodeMap.set(tId, {
                id: tId,
                lon: tLon,
                lat: tLat
            });
        }

        if (sourceValid && targetValid) {
            edges.push({
                source: sId,
                target: tId,
                weight: toNumber(row.weight) ?? 1,
                row
            });
        }
    }

    return {
        nodes: Array.from(nodeMap.values()),
        edges
    };
}

function buildGraphCacheForDataset(datasetKey) {
    const data = datasets[datasetKey];
    const years = [...new Set(getYears(data))];

    for (const year of years) {
        graphCache[datasetKey].set(year, buildGraphForYear(data, year));
    }
}

// --------------------------------------------------
// Camera helpers
// --------------------------------------------------

function zoomToGraph(graph) {
    if (!graph || !graph.nodes.length) return;

    const positions = graph.nodes.map(n => makePosition(n.lon, n.lat));
    const bs = Cesium.BoundingSphere.fromPoints(positions);

    viewer.camera.flyToBoundingSphere(bs, {
        duration: 1.5,
        offset: new Cesium.HeadingPitchRange(
            0,
            -1.2,
            Math.max(bs.radius * 2.5, 2_000_000)
        )
    });
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

        const superpoint = {
            id: superId,
            lon: lonSum / count,
            lat: latSum / count,
            count,
            members: members.map(m => m.id)
        };

        superpoints.push(superpoint);

        for (const member of members) {
            nodeToSuperpoint.set(member.id, superId);
        }
    }

    return {
        superpoints,
        nodeToSuperpoint
    };
}

// --------------------------------------------------
// Aggregate raw edges into super-edges
// --------------------------------------------------

function aggregateEdges(rawEdges, nodeToSuperpoint, directed = DIRECTED_EDGES) {
    const superEdgeMap = new Map();

    for (const edge of rawEdges) {
        const sSuper = nodeToSuperpoint.get(edge.source);
        const tSuper = nodeToSuperpoint.get(edge.target);

        if (!sSuper || !tSuper) continue;
        if (HIDE_SELF_LOOPS && sSuper === tSuper) continue;

        const key = edgeKey(sSuper, tSuper, directed);

        if (!superEdgeMap.has(key)) {
            superEdgeMap.set(key, {
                key,
                sourceSuper: directed ? sSuper : (sSuper < tSuper ? sSuper : tSuper),
                targetSuper: directed ? tSuper : (sSuper < tSuper ? tSuper : sSuper),
                weight: 0,
                edgeCount: 0
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

function getSuperpointPixelSize(count) {
    // More visible growth with cluster size
    if (count <= 1) return 10;
    return Math.min(52, 10 + Math.sqrt(count) * 6);
}

function getEdgeWidth(weight) {
    // Much thicker edges
    if (weight <= 1) return 2.5;
    return Math.min(18, 2.5 + Math.sqrt(weight) * 1.8);
}

function getLabelFont(count) {
    if (count < 10) return "bold 14px sans-serif";
    if (count < 100) return "bold 16px sans-serif";
    if (count < 1000) return "bold 18px sans-serif";
    return "bold 20px sans-serif";
}

// --------------------------------------------------
// Rendering
// --------------------------------------------------

function renderSuperpoints(superpoints) {
    pointDataSource.entities.removeAll();

    for (const sp of superpoints) {
        const isCluster = sp.count > 1;
        const pixelSize = getSuperpointPixelSize(sp.count);

        pointDataSource.entities.add({
            id: sp.id,
            position: makePosition(sp.lon, sp.lat),

            point: {
                pixelSize: pixelSize,
                color: isCluster ? Cesium.Color.ORANGE : Cesium.Color.RED,
                outlineColor: Cesium.Color.WHITE,
                outlineWidth: 2,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },

            label: isCluster ? {
                text: String(sp.count),
                font: getLabelFont(sp.count),
                fillColor: Cesium.Color.BLACK,
                outlineColor: Cesium.Color.WHITE,
                outlineWidth: 3,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,

                // Put the label above the circle instead of centered inside it
                verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
                pixelOffset: new Cesium.Cartesian2(0, -(pixelSize * 0.7)),

                showBackground: true,
                backgroundColor: Cesium.Color.WHITE.withAlpha(0.75),

                disableDepthTestDistance: Number.POSITIVE_INFINITY,
                scale: 1.0,
            } : undefined,

            properties: {
                type: "superpoint",
                count: sp.count,
                members: sp.members,
            }
        });
    }
}

function renderSuperEdges(superpoints, superEdges) {
    edgeDataSource.entities.removeAll();

    const superpointById = new Map(superpoints.map(sp => [sp.id, sp]));

    for (const edge of superEdges) {
        const a = superpointById.get(edge.sourceSuper);
        const b = superpointById.get(edge.targetSuper);

        if (!a || !b) continue;

        edgeDataSource.entities.add({
            polyline: {
                positions: [
                    makePosition(a.lon, a.lat),
                    makePosition(b.lon, b.lat),
                ],
                width: getEdgeWidth(edge.weight),
                material: Cesium.Color.CORNFLOWERBLUE.withAlpha(0.8),
                clampToGround: false,
            },
            properties: {
                type: "superedge",
                weight: edge.weight,
                edgeCount: edge.edgeCount,
                sourceSuper: edge.sourceSuper,
                targetSuper: edge.targetSuper,
            }
        });
    }
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
        viewer.scene.requestRender();
        return;
    }

    if (zoom) {
        zoomToGraph(graph);
    }

    const cellSizeDeg = getClusterCellSizeDegrees();
    const { superpoints, nodeToSuperpoint } = computeSuperpoints(graph.nodes, cellSizeDeg);
    const superEdges = aggregateEdges(graph.edges, nodeToSuperpoint, DIRECTED_EDGES);

    renderSuperpoints(superpoints);
    renderSuperEdges(superpoints, superEdges);

    yearValue.textContent = year;

    console.log("year", year);
    console.log("raw nodes", graph.nodes.length);
    console.log("raw edges", graph.edges.length);
    console.log("cell size deg", cellSizeDeg);
    console.log("superpoints", superpoints.length);
    console.log("superedges", superEdges.length);

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
        yearValue.textContent = "0";
        return;
    }

    const minYear = Math.min(...years);
    const maxYear = Math.max(...years);

    yearSlider.min = minYear;
    yearSlider.max = maxYear;
    yearSlider.value = minYear;
    yearValue.textContent = minYear;
}

function showYear(year, options = {}) {
    refreshGraph(year, options);
}

function initUI() {
    updateSliderRange();

    setTimeout(() => {
        showYear(Number(yearSlider.value), { zoom: true, force: true });
        hasInitialZoomed = true;
    }, 150);
}

yearSlider.addEventListener("input", function () {
    const selectedYear = Number(this.value);
    yearValue.textContent = selectedYear;
    showYear(selectedYear, { force: true });
});

datasetSelect.addEventListener("change", function () {
    currentDataset = this.value;
    lastRefreshKey = null;
    updateSliderRange();
    showYear(Number(yearSlider.value), { zoom: true, force: true });
});

viewer.camera.moveEnd.addEventListener(
    debounce(() => {
        if (!hasInitialZoomed) return;
        showYear(Number(yearSlider.value));
    }, 120)
);
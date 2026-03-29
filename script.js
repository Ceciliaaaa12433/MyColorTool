const SUPABASE_URL = 'https://jqwlliuuerfojvrkerdi.supabase.co';
const SUPABASE_ANON_KEY =
    'sb_publishable_kuUS0ah0JM0heuD4uae2Rg_61T_2wFX';

const supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY
);

const SAVE_BTN_DEFAULT = '保存当前颜色';
const SAVE_BTN_SUCCESS = '保存成功！';
const HISTORY_FETCH_LIMIT = 36;

// DOM Elements
const uploadArea = document.getElementById('uploadArea');
const fileInput = document.getElementById('fileInput');
const mainContent = document.getElementById('mainContent');
const previewImage = document.getElementById('previewImage');
const extractBtn = document.getElementById('extractBtn');
const randomBtn = document.getElementById('randomBtn');
const resetBtn = document.getElementById('resetBtn');
const saveBtn = document.getElementById('saveBtn');
const paletteContainer = document.getElementById('paletteContainer');
const systemLog = document.getElementById('systemLog');
const historyWallGrid = document.getElementById('historyWallGrid');

// State
let originalImageData = null;
let extractedColors = [];
let originalColors = [];
let currentHueOffset = 0;
let colorThief = null;
let lastLogLines = [];
let saveSuccessTimer = null;

// Initialize Color Thief
if (typeof ColorThief !== 'undefined') {
    colorThief = new ColorThief();
}

// Initialize
init();

function init() {
    // File input click
    uploadArea.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', handleFileSelect);

    // Drag and drop
    uploadArea.addEventListener('dragover', handleDragOver);
    uploadArea.addEventListener('dragleave', handleDragLeave);
    uploadArea.addEventListener('drop', handleDrop);

    // Buttons
    extractBtn.addEventListener('click', extractPalette);
    randomBtn.addEventListener('click', randomizeHue);
    resetBtn.addEventListener('click', resetColors);
    saveBtn.addEventListener('click', saveCurrentPalette);

    if (historyWallGrid) {
        historyWallGrid.addEventListener('click', onHistorySwatchClick);
        historyWallGrid.addEventListener('keydown', onHistorySwatchKeydown);
    }

    logLine('Ready.');
    loadHistoryWall();
}

let toastHideTimer = null;

function showCopyToast() {
    let el = document.getElementById('copyToast');
    if (!el) {
        el = document.createElement('div');
        el.id = 'copyToast';
        el.className = 'toast';
        el.setAttribute('role', 'status');
        el.setAttribute('aria-live', 'polite');
        document.body.appendChild(el);
    }
    el.textContent = '复制成功！';
    el.classList.add('toast--visible');
    if (toastHideTimer) clearTimeout(toastHideTimer);
    toastHideTimer = setTimeout(() => {
        el.classList.remove('toast--visible');
        toastHideTimer = null;
    }, 1600);
}

function onHistorySwatchClick(e) {
    const el = e.target.closest('.history-card__swatch[data-hex]');
    if (!el || el.classList.contains('history-card__swatch--empty')) return;
    const hex = el.dataset.hex;
    if (!hex) return;
    copyHexToClipboard(hex);
}

function onHistorySwatchKeydown(e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const el = e.target.closest('.history-card__swatch[data-hex]');
    if (!el || el.classList.contains('history-card__swatch--empty')) return;
    e.preventDefault();
    copyHexToClipboard(el.dataset.hex);
}

function copyHexToClipboard(hex) {
    navigator.clipboard.writeText(hex).then(
        () => {
            showCopyToast();
            logLine(`History: copied ${hex}`);
        },
        (err) => {
            console.error(err);
            logLine('Copy failed.');
        }
    );
}

function setPaletteActionsEnabled(enabled) {
    randomBtn.disabled = !enabled;
    resetBtn.disabled = !enabled;
    saveBtn.disabled = !enabled;
}

function resetSaveButtonLabel() {
    if (saveSuccessTimer) {
        clearTimeout(saveSuccessTimer);
        saveSuccessTimer = null;
    }
    saveBtn.textContent = SAVE_BTN_DEFAULT;
}

// File Handling
function handleFileSelect(e) {
    const file = e.target.files[0];
    if (file && file.type.startsWith('image/')) {
        loadImage(file);
    }
}

function handleDragOver(e) {
    e.preventDefault();
    uploadArea.classList.add('is-dragover');
}

function handleDragLeave(e) {
    e.preventDefault();
    uploadArea.classList.remove('is-dragover');
}

function handleDrop(e) {
    e.preventDefault();
    uploadArea.classList.remove('is-dragover');
    
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
        loadImage(file);
    }
}

function loadImage(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        previewImage.src = e.target.result;
        previewImage.onload = () => {
            // Show main content, hide upload area
            uploadArea.style.display = 'none';
            mainContent.style.display = 'flex';
            
            // Store original image
            originalImageData = previewImage.src;
            
            // Reset state
            extractedColors = [];
            originalColors = [];
            currentHueOffset = 0;
            previewImage.style.filter = '';
            setPaletteActionsEnabled(false);
            resetSaveButtonLabel();

            // Reset palette
            paletteContainer.innerHTML = '<div class="palette-placeholder">Click EXTRACT to analyze colors</div>';
            logLine(`Loaded image: ${file.name}`);
        };
    };
    reader.readAsDataURL(file);
}

// Extract Color Palette
function extractPalette() {
    if (!colorThief || !previewImage.complete) {
        logLine('Image not ready. Please wait…');
        return;
    }

    try {
        logLine('Analyzing pixels...');
        // Get color palette (5 colors)
        const palette = colorThief.getPalette(previewImage, 5);
        
        if (!palette || palette.length === 0) {
            logLine('Failed to extract colors.');
            return;
        }

        // Convert to our format and ensure diversity
        let colors = palette.map(color => ({
            r: color[0],
            g: color[1],
            b: color[2],
            hex: rgbToHex(color[0], color[1], color[2])
        }));

        // Filter colors to ensure diversity (minimum distance between colors)
        colors = filterColorsByDistance(colors, 40);

        // If we have less than 5 colors, fill with remaining from palette
        if (colors.length < 5) {
            const used = new Set(colors.map(c => c.hex));
            for (const color of palette) {
                if (colors.length >= 5) break;
                const hex = rgbToHex(color[0], color[1], color[2]);
                if (!used.has(hex)) {
                    colors.push({
                        r: color[0],
                        g: color[1],
                        b: color[2],
                        hex: hex
                    });
                }
            }
        }

        // Calculate percentages by sampling pixels and assigning to nearest palette color
        extractedColors = computePercentages(colors);

        // Store original colors
        originalColors = JSON.parse(JSON.stringify(extractedColors));

        // Display palette
        displayPalette();
        resetSaveButtonLabel();

        // Enable buttons
        setPaletteActionsEnabled(true);
        logLine(`Palette extracted: ${extractedColors.length} colors.`);
    } catch (error) {
        console.error('Error extracting palette:', error);
        logLine('Extraction error. Try another image.');
    }
}

// Filter colors by distance to ensure diversity
function filterColorsByDistance(colors, minDistance) {
    const filtered = [];
    
    for (const color of colors) {
        let tooClose = false;
        
        for (const existing of filtered) {
            const dist = colorDistance(
                [color.r, color.g, color.b],
                [existing.r, existing.g, existing.b]
            );
            
            if (dist < minDistance) {
                tooClose = true;
                break;
            }
        }
        
        if (!tooClose) {
            filtered.push(color);
            if (filtered.length >= 5) break;
        }
    }
    
    // If we don't have 5 colors, add more even if closer
    if (filtered.length < 5) {
        const used = new Set(filtered.map(c => c.hex));
        for (const color of colors) {
            if (filtered.length >= 5) break;
            if (!used.has(color.hex)) {
                filtered.push(color);
            }
        }
    }
    
    return filtered.slice(0, 5);
}

function colorDistance(color1, color2) {
    const r = color1[0] - color2[0];
    const g = color1[1] - color2[1];
    const b = color1[2] - color2[2];
    return Math.sqrt(r * r + g * g + b * b);
}

function computePercentages(colors) {
    // Defensive copy (we will add percentage)
    const palette = colors.slice(0, 5).map(c => ({ ...c, percentage: 0 }));

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    // Downscale for speed
    const maxSide = 320;
    const scale = Math.min(1, maxSide / Math.max(previewImage.naturalWidth || 1, previewImage.naturalHeight || 1));
    const w = Math.max(1, Math.floor((previewImage.naturalWidth || previewImage.width) * scale));
    const h = Math.max(1, Math.floor((previewImage.naturalHeight || previewImage.height) * scale));

    canvas.width = w;
    canvas.height = h;
    ctx.drawImage(previewImage, 0, 0, w, h);

    const { data } = ctx.getImageData(0, 0, w, h);
    const pixelCount = w * h;

    // Sample pixels (adaptive)
    const sampleRate = Math.max(1, Math.floor(pixelCount / 20000));

    const counts = new Array(palette.length).fill(0);
    let total = 0;

    for (let i = 0; i < pixelCount; i += sampleRate) {
        const idx = i * 4;
        const a = data[idx + 3];
        if (a < 200) continue;

        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];

        let best = 0;
        let bestDist = Infinity;
        for (let p = 0; p < palette.length; p++) {
            const pr = palette[p].r - r;
            const pg = palette[p].g - g;
            const pb = palette[p].b - b;
            const dist = pr * pr + pg * pg + pb * pb;
            if (dist < bestDist) {
                bestDist = dist;
                best = p;
            }
        }

        counts[best] += 1;
        total += 1;
    }

    if (total === 0) {
        const equal = Math.round(100 / palette.length);
        return palette.map((c, i) => ({
            ...c,
            percentage: i === palette.length - 1 ? 100 - equal * (palette.length - 1) : equal
        }));
    }

    // Convert to percentages (rounded, sum to 100)
    const raw = counts.map(c => (c / total) * 100);
    const rounded = raw.map(v => Math.floor(v));
    let remainder = 100 - rounded.reduce((s, v) => s + v, 0);

    // Distribute remainder to largest fractional parts
    const frac = raw.map((v, i) => ({ i, frac: v - Math.floor(v) })).sort((a, b) => b.frac - a.frac);
    for (let k = 0; k < frac.length && remainder > 0; k++) {
        rounded[frac[k].i] += 1;
        remainder -= 1;
    }

    return palette.map((c, i) => ({ ...c, percentage: rounded[i] }));
}

// Randomize Hue
function randomizeHue() {
    if (extractedColors.length === 0) return;

    // Generate random hue offset (0-360 degrees)
    currentHueOffset = Math.floor(Math.random() * 360);
    
    // Apply hue rotation to image
    previewImage.style.filter = `hue-rotate(${currentHueOffset}deg)`;
    
    // Update extracted colors with hue shift
    extractedColors = originalColors.map(color => {
        const hsl = rgbToHsl(color.r, color.g, color.b);
        const newHue = (hsl.h + currentHueOffset) % 360;
        const rgb = hslToRgb(newHue, hsl.s, hsl.l);
        return {
            ...color,
            r: rgb.r,
            g: rgb.g,
            b: rgb.b,
            hex: rgbToHex(rgb.r, rgb.g, rgb.b),
            percentage: color.percentage
        };
    });
    
    displayPalette();
    resetSaveButtonLabel();
    logLine(`Hue shifted by ${currentHueOffset}deg.`);
}

// Reset Colors
function resetColors() {
    if (originalColors.length === 0) return;

    // Reset hue offset
    currentHueOffset = 0;
    previewImage.style.filter = '';
    
    // Restore original colors
    extractedColors = JSON.parse(JSON.stringify(originalColors));
    
    displayPalette();
    resetSaveButtonLabel();
    logLine('Reset to original palette.');
}

// Display Palette
function displayPalette() {
    if (extractedColors.length === 0) {
        paletteContainer.innerHTML = '<div class="palette-placeholder">Click EXTRACT to analyze colors</div>';
        return;
    }
    
    paletteContainer.innerHTML = extractedColors.map((color, index) => {
        const rgbText = `RGB(${color.r}, ${color.g}, ${color.b})`;
        return `
            <div class="floppy">
                <div class="floppy__label">A:</div>
                <div class="floppy__color" style="background-color:${color.hex}"></div>
                <div class="floppy__pct">${color.percentage}%</div>
                <div class="floppy__meta">
                    <div class="floppy__hex" data-hex="${color.hex}">${color.hex}</div>
                    <div class="floppy__rgb">${rgbText}</div>
                </div>
            </div>
        `;
    }).join('');
    
    // Add click handlers for copying
    paletteContainer.querySelectorAll('.floppy__hex').forEach(hexEl => {
        hexEl.addEventListener('click', handleCopyHex);
    });
}

// Handle Copy Hex
function handleCopyHex(e) {
    e.stopPropagation();
    const hexEl = e.target;
    const hex = hexEl.dataset.hex;
    
    // Copy to clipboard
    navigator.clipboard.writeText(hex).then(() => {
        // Show "Copied!" feedback
        const originalText = hexEl.textContent;
        hexEl.textContent = 'Copied!';
        hexEl.classList.add('copied');
        
        // Restore after 1 second
        setTimeout(() => {
            hexEl.textContent = originalText;
            hexEl.classList.remove('copied');
        }, 1000);
        logLine(`Copied ${hex}`);
    }).catch(err => {
        console.error('Failed to copy:', err);
        logLine('Copy failed.');
    });
}

/**
 * Persists the current palette to Supabase `saved_colors`.
 * Expects a jsonb column `colors` storing an array of { r, g, b, hex, percentage }.
 */
async function saveCurrentPalette() {
    if (extractedColors.length === 0) {
        logLine('Nothing to save. Extract a palette first.');
        return;
    }

    const colors = extractedColors.map(({ r, g, b, hex, percentage }) => ({
        r,
        g,
        b,
        hex,
        percentage
    }));

    saveBtn.disabled = true;
    try {
        const { error } = await supabaseClient
            .from('saved_colors')
            .insert({ colors });
        if (error) {
            console.error(error);
            logLine(`Save failed: ${error.message}`);
            return;
        }
        logLine(`Saved ${colors.length} colors to the cloud.`);
        await loadHistoryWall();
        if (saveSuccessTimer) clearTimeout(saveSuccessTimer);
        saveBtn.textContent = SAVE_BTN_SUCCESS;
        saveSuccessTimer = setTimeout(() => {
            saveBtn.textContent = SAVE_BTN_DEFAULT;
            saveSuccessTimer = null;
        }, 2000);
    } catch (err) {
        console.error(err);
        logLine('Save failed (network or configuration).');
    } finally {
        saveBtn.disabled = false;
    }
}

/**
 * Supabase / PostgREST 返回的 `colors` 可能是 jsonb 数组，也可能是文本列里的 JSON 字符串。
 */
function normalizeColorsValue(raw) {
    if (raw == null) return [];
    if (Array.isArray(raw)) return raw;
    if (typeof raw === 'string') {
        try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }
    if (typeof raw === 'object' && (raw.hex || Number.isFinite(raw.r))) {
        return [raw];
    }
    return [];
}

function colorEntryToHex(c) {
    if (!c) return '#E0E4E8';
    if (typeof c === 'string') {
        const s = c.trim();
        return s.startsWith('#') ? s : `#${s}`;
    }
    if (c.hex) return c.hex;
    if (Number.isFinite(c.r))
        return rgbToHex(c.r, c.g, c.b);
    return '#CCCCCC';
}

function formatHistoryDate(iso) {
    if (!iso) return '';
    try {
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return '';
        return new Intl.DateTimeFormat('zh-CN', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        }).format(d);
    } catch {
        return '';
    }
}

function renderHistoryWall(rows) {
    if (!historyWallGrid) return;
    if (!rows || rows.length === 0) {
        historyWallGrid.innerHTML =
            '<p class="history-wall__empty">暂无历史配色，保存后即可在此汇聚。</p>';
        return;
    }

    historyWallGrid.innerHTML = rows
        .map((row) => {
            const arr = normalizeColorsValue(row.colors);
            const swatches = arr
                .map((c) => {
                    const hex = colorEntryToHex(c);
                    const safeHex = String(hex).replace(/"/g, '');
                    return `<span class="history-card__swatch" role="button" tabindex="0" data-hex="${safeHex}" style="background-color:${safeHex}" title="点击复制 ${safeHex}"></span>`;
                })
                .join('');
            const dateStr = row.created_at
                ? formatHistoryDate(row.created_at)
                : '';
            const idAttr =
                row.id !== undefined && row.id !== null
                    ? ` data-id="${String(row.id).replace(/"/g, '')}"`
                    : '';
            return `<article class="history-card"${idAttr}>
                <div class="history-card__strip" role="group" aria-label="${arr.length} 种颜色，点击色块复制 Hex">${swatches || '<span class="history-card__swatch history-card__swatch--empty"></span>'}</div>
                <div class="history-card__meta">
                    <span class="history-card__count">${arr.length} 色</span>
                    ${dateStr ? `<time class="history-card__time" datetime="${String(row.created_at).replace(/"/g, '')}">${dateStr}</time>` : ''}
                </div>
            </article>`;
        })
        .join('');
}

async function loadHistoryWall() {
    if (!historyWallGrid) return;
    historyWallGrid.innerHTML =
        '<p class="history-wall__empty history-wall__empty--muted">加载中…</p>';
    try {
        let { data, error } = await supabaseClient
            .from('saved_colors')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(HISTORY_FETCH_LIMIT);
        console.log('读取到的数据:', data, error);
        if (error) {
            const retry = await supabaseClient
                .from('saved_colors')
                .select('*')
                .limit(HISTORY_FETCH_LIMIT);
            data = retry.data;
            error = retry.error;
            console.log('读取到的数据:', data, error);
        }
        if (error) {
            console.error(error);
            historyWallGrid.innerHTML =
                '<p class="history-wall__empty history-wall__empty--error">暂时无法加载历史配色</p>';
            logLine(`History: ${error.message}`);
            return;
        }
        renderHistoryWall(data);
    } catch (err) {
        console.error(err);
        historyWallGrid.innerHTML =
            '<p class="history-wall__empty history-wall__empty--error">暂时无法加载历史配色</p>';
    }
}

function logLine(message) {
    const t = new Date();
    const hh = String(t.getHours()).padStart(2, '0');
    const mm = String(t.getMinutes()).padStart(2, '0');
    const ss = String(t.getSeconds()).padStart(2, '0');
    lastLogLines.push(`[${hh}:${mm}:${ss}] ${message}`);
    if (lastLogLines.length > 7) lastLogLines = lastLogLines.slice(-7);
    if (systemLog) systemLog.textContent = lastLogLines.join('\n');
}

// Color Conversion Functions
function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(x => {
        const hex = Math.round(x).toString(16);
        return hex.length === 1 ? '0' + hex : hex;
    }).join('').toUpperCase();
}

function rgbToHsl(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;
    
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;
    
    if (max === min) {
        h = s = 0;
    } else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        
        switch (max) {
            case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
            case g: h = ((b - r) / d + 2) / 6; break;
            case b: h = ((r - g) / d + 4) / 6; break;
        }
    }
    
    return {
        h: Math.round(h * 360),
        s: Math.round(s * 100),
        l: Math.round(l * 100)
    };
}

function hslToRgb(h, s, l) {
    h /= 360;
    s /= 100;
    l /= 100;
    
    let r, g, b;
    
    if (s === 0) {
        r = g = b = l;
    } else {
        const hue2rgb = (p, q, t) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1/6) return p + (q - p) * 6 * t;
            if (t < 1/2) return q;
            if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
            return p;
        };
        
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1/3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1/3);
    }
    
    return {
        r: Math.round(r * 255),
        g: Math.round(g * 255),
        b: Math.round(b * 255)
    };
}

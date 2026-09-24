// Drawing canvas system for Drawing Duel.
// Manages brush, eraser, fill, undo, clear tools.
// Coordinates are normalized 0-1 for network transmission.

export const COLORS = [
    '#000000', '#ffffff', '#e0584f', '#f97316', '#f2c14e', '#2ec495',
    '#3b82f6', '#8b5cf6', '#ec4899', '#92400e', '#6b7280', '#1e3a2f',
];

export const SIZES = [
    { label: 'S', px: 2 },
    { label: 'M', px: 5 },
    { label: 'L', px: 10 },
    { label: 'XL', px: 20 },
];

export class DrawCanvas {
    constructor(canvasEl) {
        this.el = canvasEl;
        this.ctx2d = canvasEl.getContext('2d');
        this.strokes = [];
        this.currentStroke = null;
        this.tool = 'brush';
        this.color = '#000000';
        this.size = 5;
        this.enabled = false;
        this.onStroke = null; // callback when a stroke completes
        this.onFill = null;
        this.onClear = null;
        this.onUndo = null;
        this._ptrDown = this._ptrDown.bind(this);
        this._ptrMove = this._ptrMove.bind(this);
        this._ptrUp = this._ptrUp.bind(this);
        canvasEl.addEventListener('pointerdown', this._ptrDown);
        canvasEl.addEventListener('pointermove', this._ptrMove);
        canvasEl.addEventListener('pointerup', this._ptrUp);
        canvasEl.addEventListener('pointercancel', this._ptrUp);
        canvasEl.addEventListener('pointerleave', this._ptrUp);
        this.clear(true);
    }

    resize(w, h) {
        this.el.width = w;
        this.el.height = h;
        this.redraw();
    }

    // Normalized coords
    _norm(e) {
        const r = this.el.getBoundingClientRect();
        return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
    }

    _ptrDown(e) {
        if (!this.enabled) return;
        e.preventDefault();
        if (this.tool === 'fill') {
            const p = this._norm(e);
            this._floodFill(Math.round(p.x * this.el.width), Math.round(p.y * this.el.height), this.color);
            if (this.onFill) this.onFill(p.x, p.y, this.color);
            return;
        }
        this.el.setPointerCapture(e.pointerId);
        const p = this._norm(e);
        this.currentStroke = {
            points: [p],
            color: this.tool === 'eraser' ? '#ffffff' : this.color,
            size: this.size,
            tool: this.tool,
        };
        this._drawSegment(p, p, this.currentStroke);
    }

    _ptrMove(e) {
        if (!this.currentStroke) return;
        e.preventDefault();
        const p = this._norm(e);
        const prev = this.currentStroke.points[this.currentStroke.points.length - 1];
        // Subsample to avoid sending too many points
        const dist = Math.hypot(p.x - prev.x, p.y - prev.y);
        if (dist < 0.003) return;
        this.currentStroke.points.push(p);
        this._drawSegment(prev, p, this.currentStroke);
    }

    _ptrUp(e) {
        if (!this.currentStroke) return;
        const stroke = this.currentStroke;
        this.currentStroke = null;
        this.strokes.push(stroke);
        if (this.onStroke) this.onStroke(stroke);
    }

    _drawSegment(from, to, stroke) {
        const c = this.ctx2d;
        const w = this.el.width, h = this.el.height;
        c.lineCap = 'round';
        c.lineJoin = 'round';
        c.strokeStyle = stroke.color;
        c.lineWidth = (stroke.size / 600) * w;
        c.beginPath();
        c.moveTo(from.x * w, from.y * h);
        c.lineTo(to.x * w, to.y * h);
        c.stroke();
    }

    _drawFullStroke(stroke) {
        if (stroke.points.length < 1) return;
        const c = this.ctx2d;
        const w = this.el.width, h = this.el.height;
        c.lineCap = 'round';
        c.lineJoin = 'round';
        c.strokeStyle = stroke.color;
        c.lineWidth = (stroke.size / 600) * w;
        c.beginPath();
        const p0 = stroke.points[0];
        c.moveTo(p0.x * w, p0.y * h);
        if (stroke.points.length === 1) {
            c.lineTo(p0.x * w + 0.5, p0.y * h + 0.5);
        } else {
            for (let i = 1; i < stroke.points.length; i++) {
                c.lineTo(stroke.points[i].x * w, stroke.points[i].y * h);
            }
        }
        c.stroke();
    }

    _floodFill(startX, startY, fillColor) {
        const c = this.ctx2d;
        const w = this.el.width, h = this.el.height;
        const imageData = c.getImageData(0, 0, w, h);
        const data = imageData.data;
        const idx = (startY * w + startX) * 4;
        const targetR = data[idx], targetG = data[idx + 1], targetB = data[idx + 2];

        // Parse fill color
        const tmp = document.createElement('canvas'); tmp.width = 1; tmp.height = 1;
        const tc = tmp.getContext('2d'); tc.fillStyle = fillColor; tc.fillRect(0, 0, 1, 1);
        const fc = tc.getImageData(0, 0, 1, 1).data;
        if (targetR === fc[0] && targetG === fc[1] && targetB === fc[2]) return;

        const stack = [[startX, startY]];
        const match = (i) => Math.abs(data[i] - targetR) < 20 && Math.abs(data[i + 1] - targetG) < 20 && Math.abs(data[i + 2] - targetB) < 20;
        let maxOps = w * h;
        while (stack.length && maxOps-- > 0) {
            const [x, y] = stack.pop();
            if (x < 0 || x >= w || y < 0 || y >= h) continue;
            const i = (y * w + x) * 4;
            if (!match(i)) continue;
            data[i] = fc[0]; data[i + 1] = fc[1]; data[i + 2] = fc[2]; data[i + 3] = 255;
            stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
        }
        c.putImageData(imageData, 0, 0);
        // Save as a fill stroke for replay
        this.strokes.push({ type: 'fill', x: startX / w, y: startY / h, color: fillColor });
    }

    applyRemoteFill(nx, ny, color) {
        this._floodFill(Math.round(nx * this.el.width), Math.round(ny * this.el.height), color);
    }

    addRemoteStroke(stroke) {
        this.strokes.push(stroke);
        this._drawFullStroke(stroke);
    }

    undo() {
        if (!this.strokes.length) return;
        this.strokes.pop();
        this.redraw();
        if (this.onUndo) this.onUndo();
    }

    clear(silent) {
        this.strokes = [];
        const c = this.ctx2d;
        c.fillStyle = '#ffffff';
        c.fillRect(0, 0, this.el.width, this.el.height);
        if (!silent && this.onClear) this.onClear();
    }

    redraw() {
        const c = this.ctx2d;
        c.fillStyle = '#ffffff';
        c.fillRect(0, 0, this.el.width, this.el.height);
        for (const s of this.strokes) {
            if (s.type === 'fill') {
                this._floodFill(Math.round(s.x * this.el.width), Math.round(s.y * this.el.height), s.color);
            } else {
                this._drawFullStroke(s);
            }
        }
    }

    setTool(tool) { this.tool = tool; }
    setColor(color) { this.color = color; if (this.tool === 'eraser') this.tool = 'brush'; }
    setSize(px) { this.size = px; }
    setEnabled(on) { this.enabled = on; }
}

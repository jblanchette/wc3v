const MapImporter = class {
    constructor () {
        this.ctx = null;
        this.inputFile = null;
    }

    bootstrap () {
        const self = this;

        this.canvas = document.getElementById('main-canvas');
        this.ctx = this.canvas.getContext('2d');

        this.inputMapFile = document.getElementById("ctl-import-file-map");
        this.inputGridFile = document.getElementById("ctl-import-file-grid");

        this.inputMapFile.onchange = () => {
            self.handleFileChange('map', self.inputMapFile);
        };

        this.inputGridFile.onchange = () => {
            self.handleFileChange('grid', self.inputGridFile);
        };

        this.showMapCtrl = document.getElementById("chk-show-map");
        this.showMapCtrl.onchange = (e) => {
            self.images.map.shown = e.target.checked;
            self.render();
        };

        this.showGridCtrl = document.getElementById("chk-show-grid");
        this.showGridCtrl.onchange = (e) => {
            self.images.grid.shown = e.target.checked;
            self.render();
        };

        const buttons = [
            { key: "left",  x: -1, y:  0 },
            { key: "right", x:  1, y:  0 },
            { key: "up",    x:  0, y: -1 },
            { key: "down",  x:  0, y:  1 },
            { key: "left-big",  x: -10, y:   0 },
            { key: "right-big", x:  10, y:   0 },
            { key: "up-big",    x:   0, y: -10 },
            { key: "down-big",  x:   0, y:  10 }
        ];

        buttons.forEach(button => {
            const { key, x, y } = button;
            const btn = document.getElementById(`ctl-${key}`);
            btn.onclick = () => {
                self.images.map.x += x;
                self.images.map.y += y;

                self.render();
            };
        });

        document.getElementById("ctl-save").onclick = () => {
            const ready = Object.values(this.images).filter(img => {
                return !img.ready || !img.img;
            });

            if (ready.length > 0) {
                console.log("not in a ready state to save and export");
                return;
            }

            self.export();
        };

        this.images = {
            grid: {
                ready: false,
                shown: true,
                img: null,
                x: 0,
                y: 0
            },
            map: {
                ready: false,
                shown: true,
                img: null,
                x: 0,
                y: 0
            }
        };
    }

    handleFileChange (which, target) {
        try {
            const self = this;
            const newFile = target.files[0];
            const { type } = newFile;

            if (type !== "image/jpeg") {
                console.log("does not support image type: ", type);
                throw new Error("unsupported image format");
            }

            console.log("uploading new file: ", which);

            self.images[which].ready = false;

            const img = new Image();
            img.src = URL.createObjectURL(newFile);

            img.onload = () => {
                console.log("finished loading img for", which);

                self.images[which].img = img;
                self.images[which].ready = true;
                self.images[which].x = 0;
                self.images[which].y = 0;

                self.render();
            };
        } catch (err) {
            console.log("file upload error: ", err);
        }
    }

    render () {
        console.log("render");
        const { ctx } = this;

        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, 900, 900);
        ctx.restore();

        Object.values(this.images).forEach(item => {
            if (!item.ready || !item.shown) {
                return;
            }

            ctx.drawImage(item.img, item.x, item.y);
        });

        document.getElementById('map-x-position').innerHTML = `x: ${this.images.map.x}`;
        document.getElementById('map-y-position').innerHTML = `y: ${this.images.map.y}`;
    }

    export () {
        console.log("saving and exporting");

        console.log("grid props:", this.images.grid.img.height, this.images.grid.img.width);
        const { canvas } = this;

        const oldValue = this.images.grid.shown;

        this.images.grid.shown = false;
        this.render();
        
        this.images.grid.shown = oldValue;

        canvas.height = this.images.grid.img.height;
        canvas.width = this.images.grid.img.width;

        this.render();

        const downloadLink = document.createElement('a');
        downloadLink.setAttribute('download', 'exported-map.jpg');

        canvas.toBlob(function(blob) {
            const url = URL.createObjectURL(blob);
            downloadLink.setAttribute('href', url);
            downloadLink.click();
        });

        canvas.height = 900;
        canvas.width = 900;
    }
};

window.mapImporter = new MapImporter();

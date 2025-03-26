const { EventEmitter } = require("events");
const childProcess = require("child_process");

class CameraStream extends EventEmitter {
    constructor(camera, options = { }) {
        super();
        
        this.camera = camera;
        if (options.ffmpegPath) this.ffmpegPath = options.ffmpegPath;
        if (options.storeLastFrame) this.storeLastFrame = options.storeLastFrame;
        if (options.ffmpegInputArgs) this.ffmpegInputArgs = options.ffmpegInputArgs;
        if (options.ffmpegOutputArgs) this.ffmpegOutputArgs = options.ffmpegOutputArgs;
        if (options.logs) this.logs = options.logs;
        if (options.logSize) this.logSize = options.logSize;
        this.options = options;
    }

    camera = null;
    ffmpegPath = "ffmpeg";
    storeLastFrame = false;
    ffmpegInputArgs = [];
    ffmpegOutputArgs = [];
    logs = false;
    logSize = 1024;
    
    log = "";
    ffmpegProcess = null;
    lastFrame = null;
    state = 0;
    startDate = null;

    start() {
        if (this.state === 1) return;

        this.ffmpegProcess = childProcess.spawn(this.ffmpegPath ?? "ffmpeg", [
            ...this.ffmpegInputArgs ?? [],
            "-i", this.camera.path,
            ...this.ffmpegOutputArgs ?? [],
            "-c:v", "mjpeg",
            "-f", "mjpeg",
            "-"
        ]);

        const frameArrayBuffer = [];

        this.ffmpegProcess.on("spawn", () => {
            this.state = 1;
            this.startDate = new Date();
            this.emit("start");
        });

        this.ffmpegProcess.stdout.on("data", data => {
            frameArrayBuffer.push(data);

            if (data[data.byteLength - 2] === 0xFF && data[data.byteLength - 1] === 0xD9) {
                const frameBuffer = Buffer.concat(frameArrayBuffer);
                frameArrayBuffer.length = 0;
                if (this.storeLastFrame) this.lastFrame = frameBuffer;
                this.emit("frame", frameBuffer);
            }
        });

        this.ffmpegProcess.stderr.on("data", data => {
            if (!this.logs) return;
            const log = data.toString();
            this.log += log;
            if (this.logSize && this.log.length > this.logSize) this.log = this.log.slice(-this.options.logSize);
        });

        this.ffmpegProcess.on("error", err => {
            this.state = 2;
            this.emit("error", err);
        });
        
        this.ffmpegProcess.on("close", code => {
            if (this.state === 1) {
                if (code > 0) {
                    this.state = 2;
                    this.emit("error", this.log);
                } else {
                    this.state = 0;
                }
            }
            this.emit("close", code);
        });
    }

    stop() {
        if (this.ffmpegProcess) {
            this.ffmpegProcess.kill("SIGKILL");
            this.state = 0;
        }
    }
}

module.exports = CameraStream;
const net = require("net");
const childProcess = require("child_process");
const fs = require("fs");
const { EventEmitter } = require("events");

const { Server, Router } = require("http-js");

const config = require("./config.json");

const cameraStreams = { };
const cameraClients = { };
const cameraOffFrame = fs.existsSync(config.cameraOffPath) ? fs.readFileSync(config.cameraOffPath) : null;
const cameraErrorPath = fs.existsSync(config.cameraErrorPath) ? fs.readFileSync(config.cameraErrorPath) : null;

// API Server

const server = new Server();
const { router } = server;

// Camera

router.get("/camera/:camera/", (req, res, next, params) => {
    const camera = config.cameras?.[params.camera];
    if (!camera) return next();

    const cameraStream = cameraStreams[params.camera];

    res.json({
        state: cameraStream.state,
        startDate: cameraStream.startDate,
    });
});

router.post("/camera/:camera/on/", (req, res, next, params) => {
    const camera = config.cameras?.[params.camera];
    if (!camera) return next();

    cameraStreams[params.camera].start();

    res.sendStatus(204);
});

router.post("/camera/:camera/off/", (req, res, next, params) => {
    const camera = config.cameras?.[params.camera];
    if (!camera) return next();

    cameraStreams[params.camera].stop();

    res.sendStatus(204);
});

router.get("/camera/:camera/stream/", (req, res, next, params) => {
    const camera = config.cameras?.[params.camera];
    if (!camera) return next();

    const cameraStream = cameraStreams[params.camera];

    const client = {
        req,
        res,
        queue: [],
        writing: false
    };

    const noFrameInterval = setInterval(() => {
        const frame = cameraStream.state === 0 ? cameraOffFrame : cameraStream.state === 2 ? cameraErrorPath : null;
        if (!frame) return;

        const data = Buffer.concat([
            Buffer.from(`--stream\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.byteLength}\r\n\r\n`),
            frame,
            Buffer.from("\r\n\r\n")
        ]);

        if (client.writing) {
            return client.queue.push(data);
        } else {
            if (!res.write(data)) {
                client.writing = true;
                res.once("drain", () => {
                    client.writing = false;
                    if (client.queue.length) res.write(client.queue.shift());
                });
            } else {
                if (client.queue.length) res.write(client.queue.shift());
            }
        }
    }, 1000 / 1);

    res.setHeader("Content-Type", "multipart/x-mixed-replace; boundary=stream");

    req.on("close", () => {
        const clientIndex = cameraClients[params.camera].indexOf(client);
        if (clientIndex >= 0) cameraClients[params.camera].splice(clientIndex, 1);
        clearInterval(noFrameInterval);
    });

    cameraClients[params.camera].push(client);
});

router.get("/camera/:camera/still/", (req, res, next, params) => {
    const camera = config.cameras?.[params.camera];
    if (!camera) return next();

    const cameraStream = cameraStreams[params.camera];

    if (cameraStream.state !== 1) return res.sendStatus(204);

    if (cameraStream.lastFrame) {
        res.send(cameraStream.lastFrame, "image/jpeg");
    } else {
        cameraStreams[params.camera].once("frame", frame => {
            res.send(frame, "image/jpeg");
        });
    }
});

// Light

router.get("/light/:light/", (req, res, next, params) => {
    const light = config.lights?.[params.light];
    if (!light) return next();
    res.json({
        state: getGpioValue(light.gpio)
    });
});

router.post("/light/:light/on/", (req, res, next, params) => {
    const light = config.lights?.[params.light];
    if (!light) return next();
    setGpio(light.gpio, true);
    res.sendStatus(204);
    console.log("[Light]", `${light.name ? `${light.name} (${params.light})` : params.light} turned on`);
});

router.post("/light/:light/off/", (req, res, next, params) => {
    const light = config.lights?.[params.light];
    if (!light) return next();
    setGpio(light.gpio, false);
    res.sendStatus(204);
    console.log("[Light]", `${light.name ? `${light.name} (${params.light})` : params.light} turned off`);
});

// PSU

router.get("/psu/0/", async (req, res, next, params) => {
    const data = await sendSmartHomeProtocolCommand({ system: { get_sysinfo: null } }).catch(err => {
        res.sendStatus(500);
    });

    const info = data?.system?.get_sysinfo;
    if (!info || info.err_code) return res.sendStatus(500);
    res.json({
        state: info.relay_state,
        onSince: info.relay_state ? Math.floor(Date.now() / 1000 - info.on_time) * 1000 : null,
        mac: info.mac
    });
});

router.post("/psu/0/on/", async (req, res, next, params) => {
    const data = await sendSmartHomeProtocolCommand({ system: { set_relay_state: { state: 1 } } }).catch(err => {
        res.sendStatus(500);
    });

    const info = data?.system?.set_relay_state;
    if (!info || info.err_code) return res.sendStatus(500);

    res.sendStatus(204);
    console.log("[PSU]", "Turned on");
});

router.post("/psu/0/off/", async (req, res, next, params) => {
    const data = await sendSmartHomeProtocolCommand({ system: { set_relay_state: { state: 0 } } }).catch(err => {
        res.sendStatus(500);
    });

    const info = data?.system?.set_relay_state;
    if (!info || info.err_code) return res.sendStatus(500);
    
    res.sendStatus(204);
    console.log("[PSU]", "Turned off");
});

router.any("*", (req, res) => {
    res.sendStatus(404);
});

// Listen
server.listen(config.port, () => console.log(`Server is running at :${config.port}`));

// Camera streams

class CameraStream extends EventEmitter {
    constructor(camera, options = { }) {
        super();
        
        this.camera = camera;
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
        if (this.state === 1 && this.ffmpegProcess) this.ffmpegProcess.kill("SIGKILL");
    }
}

if (config.cameras) for (const cameraIndex in config.cameras) {
    const camera = config.cameras[cameraIndex];
    const cameraStream = new CameraStream(camera, {
        ffmpegInputArgs: camera.inputArgs,
        ffmpegOutputArgs: camera.outputArgs,
        logs: true
    });

    cameraStream.start();

    cameraStream.on("start", () => {
        console.log("[Camera]", `${camera.name ? `${camera.name} (${cameraIndex})` : cameraIndex} started`);
    });

    cameraStream.on("frame", frame => {
        for (const cameraClient of cameraClients[cameraIndex]) {
            const data = Buffer.concat([
                Buffer.from(`--stream\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.byteLength}\r\n\r\n`),
                frame,
                Buffer.from("\r\n\r\n")
            ]);

            if (cameraClient.writing) {
                return cameraClient.queue.push(data);
            } else {
                if (!cameraClient.res.write(data)) {
                    cameraClient.writing = true;
                    cameraClient.res.once("drain", () => {
                        cameraClient.writing = false;
                        if (cameraClient.queue.length) cameraClient.res.write(cameraClient.queue.shift());
                    });
                } else {
                    if (cameraClient.queue.length) cameraClient.res.write(cameraClient.queue.shift());
                }
            }
        }
    });

    cameraStream.on("close", () => {
        console.log("[Camera]", `${camera.name ? `${camera.name} (${cameraIndex})` : cameraIndex} closed`);
    });

    cameraStream.on("error", err => {
        console.log("[Camera]", `${camera.name ? `${camera.name} (${cameraIndex})` : cameraIndex} had an error:`, err);
        if (config.cameraRetryInterval) setTimeout(() => cameraStream.start(), config.cameraRetryInterval);
    });

    cameraStreams[cameraIndex] = cameraStream;
    cameraClients[cameraIndex] = [];
}

// GPIO

function setGpio(pin, value, direction = "output") {
    const writeDirection = direction === "output" ? "out" : direction === "input" ? "in" : "out";
    const writeValue = `${value === false ? 0 :  value === true ? 1 : value}\n`;

    // Export pin
    if (!fs.existsSync(`/sys/class/gpio/gpio${pin}`)) {
        fs.writeFileSync("/sys/class/gpio/export", pin);
    }
    // Set direction
    if (fs.readFileSync(`/sys/class/gpio/gpio${pin}/direction`, "utf-8") !== writeDirection) {
        fs.writeFileSync(`/sys/class/gpio/gpio${pin}/direction`, writeDirection);
    }
    // Set value
    fs.writeFileSync(`/sys/class/gpio/gpio${pin}/value`, writeValue);
}

function getGpioValue(pin) {
    if (!fs.existsSync(`/sys/class/gpio/gpio${pin}`)) return null;
    return parseInt(fs.readFileSync(`/sys/class/gpio/gpio${pin}/value`, "utf-8"));
}

// TP-Link Smart Home Protocol Proxy

if (config.smartHomeProtocolProxy) {
    const smartHomeProtocolProxy = net.createServer();

    smartHomeProtocolProxy.on("connection", socket => {
        const connection = net.createConnection({
            host: config.plugAddress,
            port: config.plugPort ?? 9999
        });

        connection.on("data", data => !socket.write(data) && connection.pause());
        connection.on("end", () => socket.end());
        connection.on("drain", () => socket.resume());
        connection.on("error", () => socket.end());

        socket.on("data", data => !connection.write(data) && socket.pause());
        socket.on("end", () => connection.end());
        socket.on("drain", () => connection.resume());
        socket.on("error", () => connection.end());
    });

    smartHomeProtocolProxy.listen(9999, () => console.log(`TP-Link Smart Home protocol proxy is running at :${config.plugPort ?? 9999}`));
}

// TP-Link Smart Home Protocol

function sendSmartHomeProtocolCommand(command) {
    return new Promise((resolve, reject) => {
        const connection = net.createConnection({ host: config.plugIp, port: 9999 });
        connection.write(smartHomeProtocolEncrypt(JSON.stringify(command)));
        let data;
        connection.on("data", i => data = Buffer.concat(data ? [data, i] : [i]));
        connection.on("end", () => resolve(JSON.parse(smartHomeProtocolDecrypt(data))));
        connection.on("error", err => reject(err));
    });
}

function smartHomeProtocolEncrypt(string) {
    let key = 171;
    const length = string.length;
    const result = new Uint8Array(4 + length);

    result[0] = (length >> 24) & 0xFF;
    result[1] = (length >> 16) & 0xFF;
    result[2] = (length >> 8) & 0xFF;
    result[3] = length & 0xFF;

    for (let i = 0; i < string.length; i++) {
        const a = key ^ string.charCodeAt(i);
        key = a;
        result[4 + i] = a;
    }

    return result;
}

function smartHomeProtocolDecrypt(array) {
    let key = 171;
    let result = "";

    for (let i = 4; i < array.length; i++) {
        const a = key ^ array[i];
        key = array[i];
        result += String.fromCharCode(a);
    }

    return result;
}
const fs = require("fs");

const { Server } = require("http-js");
const { sendSmartHomeProtocolCommand } = require("./utils/tp-link-smart-home-protocol");
const { getGpioValue, setGpio } = require("./utils/gpio.js");
const OctoPrint = require("./utils/OctoPrint.js");
const CameraStream = require("./utils/CameraStream");

const config = require("./config.json");

// const mainPage = fs.readFileSync("./index.html", "utf-8");
const octoPrint = new OctoPrint(`http://${config.octoprintAddress ?? "127.0.0.1"}:${config.octoprintPort ?? 5000}`, config.octoprintApiKey);
const cameraStreams = { };
const cameraClients = { };
const cameraOffFrame = fs.existsSync(config.cameraOffPath) ? fs.readFileSync(config.cameraOffPath) : null;
const cameraErrorPath = fs.existsSync(config.cameraErrorPath) ? fs.readFileSync(config.cameraErrorPath) : null;

// API Server

const server = new Server();
const { router } = server;

// Authorization
router.any("*", (req, res, next, params) => {
    // if (config.basicAuthorization && req.headers["authorization"] !== config.basicAuthorization) return res.setStatus(401).json({ error: "Authorization is required" });
    next();
});

// POST request validation
router.post("*", async (req, res, next, params) => {
    return new Promise(resolve => {
        if (req.headers["content-type"] !== "application/json") return res.setStatus(400).json({ error: "Invalid Content-Type header" });
        const dataArrayBuffer = [];
        req.on("data", data => dataArrayBuffer.push(data));
        req.on("end", () => {
            try {
                req.body = JSON.parse(Buffer.concat(dataArrayBuffer));
                next();
            } catch (err) {
                return res.setStatus(400).json({ error: "Invalid body" });
            }
            
            resolve();
        });
    });
});

// router.get("/", (req, res) => res.html(mainPage));

// OctoPrint

router.post("/send", async (req, res) => {
    if (!req.body.command) return res.setStatus(400).json({ error: "Missing command" });
    octoPrint.sendCommand(req.body.command).then(i => {
        if (i.status !== 204) return res.setStatus(500).json({ error: "Internal Server Error" });
        res.sendStatus(204);
    }).catch(err => {
        res.setStatus(500).json({ error: "Internal Server Error" });
    });
});

router.post("/job", async (req, res) => {
    octoPrint.sendJob(req.body).then(i => {
        if (i.status !== 204) return res.setStatus(500).json({ error: "Internal Server Error" });
        res.sendStatus(204);
    }).catch(err => {
        res.setStatus(500).json({ error: "Internal Server Error" });
    });
});

router.get("/job", async (req, res) => {
    octoPrint.getJob().then(job => {
        if (res.status !== 200) return res.setStatus(500).json({ error: "Internal Server Error" });
        res.json(job.json);
    }).catch(err => {
        res.setStatus(500).json({ error: "Internal Server Error" });
    });
});

// PSU

router.get("/psus", async (req, res, next, params) => {
    const psus = [];
    for (const psuIndex in config.psus) psus.push(await getPSU(psuIndex).catch(err => null));
    res.json(psus);
});

router.get("/psu/:psu/", async (req, res, next, params) => {
    if (!config.psus?.[params.psu]) return next();
    try {
        res.json(await getPSU(params.psu));
    } catch (err) {
        res.setStatus(500).json({ error: "Internal Server Error" });
    }
});

router.post("/psu/:psu/", async (req, res, next, params) => {
    if (!config.psus?.[params.psu]) return next();
    try {
        if (req.body.state !== undefined) await setPSU(params.psu, req.body.state);
        res.json(await getPSU(params.psu));
    } catch (err) {
        res.setStatus(500).json({ error: "Internal Server Error" });
    }
});

// Light

router.get("/lights", async (req, res, next, params) => {
    const lights = [];
    for (const lightIndex in config.lights) lights.push(await getLight(lightIndex).catch(err => null));
    res.json(lights);
});

router.get("/light/:light/", async (req, res, next, params) => {
    if (!config.lights?.[params.light]) return next();
    try {
        res.json(await getLight(params.light))
    } catch (err) {
        res.setStatus(500).json({ error: "Internal Server Error" });
    }
});

router.post("/light/:light/", async (req, res, next, params) => {
    if (!config.lights?.[params.light]) return next();
    try {
        if (req.body.state !== undefined) await setLight(params.light, req.body.state);
        res.json(await getLight(params.light));
    } catch (err) {
        res.setStatus(500).json({ error: "Internal Server Error" });
    }
});

// Camera

router.get("/cameras", async (req, res, next, params) => {
    const cameras = [];
    for (const cameraIndex in config.cameras) cameras.push(await getCamera(cameraIndex).catch(err => null));
    res.json(cameras);
});

router.get("/camera/:camera/", async (req, res, next, params) => {
    if (!config.cameras?.[params.camera]) return next();
    try {
        res.json(await getCamera(params.camera))
    } catch (err) {
        res.setStatus(500).json({ error: "Internal Server Error" });
    }
});

router.post("/camera/:camera/", async (req, res, next, params) => {
    if (!config.cameras?.[params.camera]) return next();
    try {
        if (req.body.state !== undefined) await setCamera(params.camera, req.body.state);
        res.json(await getCamera(params.camera));
    } catch (err) {
        res.setStatus(500).json({ error: "Internal Server Error" });
    }
});

router.get("/camera/:camera/stream/", (req, res, next, params) => {
    const camera = config.cameras?.[params.camera];
    if (!camera) return next();

    const cameraStream = cameraStreams[params.camera];

    const client = {
        req,
        res,
        send: data => clientSend(data, client),
        queue: [],
        writing: false
    };

    res.setHeader("Content-Type", "multipart/x-mixed-replace; boundary=stream");

    // Send last frame
    if (cameraStream.lastFrame) {
        client.send(createMultipartFrame(cameraStream.lastFrame));
    }

    // Send custom frames if camera is inactive
    const noFrameInterval = setInterval(() => {
        const frame = cameraStream.state === 0 ? cameraOffFrame : cameraStream.state === 2 ? cameraErrorPath : null;
        if (!frame) return;

        client.send(createMultipartFrame(frame));
    }, 1000 / 5);

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

router.any("*", (req, res) => {
    res.setStatus(404).json({ error: "Not Found" });
});

// Listen
server.listen(config.port, () => console.log(`Server is running at :${config.port}`));

// Controls

// Checks for state changes from elsewhere
if (config.stateCheckInterval) {
    const states = {
        psus: {},
        lights: {},
        cameras: {},
    };

    (async function checkStates() {
        if (config.psus) for (const psuIndex in config.psus) {
            const psu = config.psus[psuIndex];
            try {
                const { state } = await getPSU(psuIndex);
                if (states["psus"][psuIndex] !== state && psu.triggers) await runTriggers(psu.triggers, state);
                states["psus"][psuIndex] = state;
            } catch (err) { }
        }

        if (config.light) for (const lightIndex in config.lights) {
            const light = config.lights[lightIndex];
            try {
                const { state } = await getLight(lightIndex);
                if (states["lights"][lightIndex] !== state && light.triggers) await runTriggers(light.triggers, state);
                states["lights"][lightIndex] = state;
            } catch (err) { }
        }

        if (config.cameras) for (const cameraIndex in config.cameras) {
            const camera = config.cameras[cameraIndex];
            try {
                const { state } = await getCamera(cameraIndex);
                if (states["cameras"][cameraIndex] !== state && camera.triggers) await runTriggers(camera.triggers, state);
                states["cameras"][cameraIndex] = state;
            } catch (err) { }
        }

        setTimeout(checkStates, config.stateCheckInterval ?? 5000);
    })();
}

// Sync stuff together
async function runTriggers(triggers, value) {
    for (const trigger of triggers) {
        try {
            const [type, index, reversed] = trigger.split(":");
            const isReversed = (reversed === "1" || reversed === "true") ? true : false;
            
            if (type === "psu") await setPSU(index, isReversed ? !value : value); else
            if (type === "light") await setLight(index, isReversed ? !value : value); else
            if (type === "camera") await setCamera(index, isReversed ? !value : value); else
            throw new Error(`Unknown type '${type}'`);
        } catch (err) {
            console.log(`Failed to run trigger '${trigger}': ${err}`);
        }
    }
}

function getPSU(psuIndex) {
    return new Promise(async (resolve, reject) => {
        try {
            const psu = config.psus[psuIndex];
    
            if (!psu.type || psu.type === "gpio") {
                resolve({
                    state: getGpioValue(psu.gpio)
                });
            } else if (psu.type === "tp-link") {
                const data = await sendSmartHomeProtocolCommand(psu.address, { system: { get_sysinfo: null } }).catch(err => {
                    console.log("Error sending Smart Home Protocol command:", err);
                    return reject();
                });
            
                const info = data?.system?.get_sysinfo;
                if (!info || info.err_code) {
                    console.log("Smart Home Protocol response isn't correct:", info);
                    return reject();
                }
    
                resolve({
                    state: info.relay_state,
                    onSince: info.relay_state ? new Date(Math.floor(Date.now() / 1000 - info.on_time) * 1000) : null,
                    mac: info.mac
                });
            }
        } catch (err) {
            reject(err);
        }
    });
}

function setPSU(psuIndex, value) {
    return new Promise(async (resolve, reject) => {
        try {
            const psu = config.psus[psuIndex];
    
            if (!psu.type || psu.type === "gpio") {
                setGpio(psu.gpio, value);
            } else if (psu.type === "smarthomeprotocol") {
                const data = await sendSmartHomeProtocolCommand(psu.address, { system: { set_relay_state: { state: value ? 1 : 0 } } }).catch(err => {
                    console.log("Error sending Smart Home Protocol command:", err);
                    return reject();
                });
            
                const info = data?.system?.set_relay_state;
                if (!info || info.err_code) {
                    console.log("Smart Home Protocol response isn't correct:", info);
                    return reject();
                }
            }
    
            resolve();
    
            console.log("[PSU]", `${psu.name ? `${psu.name} (${psuIndex})` : psuIndex} turned ${value ? "on" : "off"}`);
    
            if (psu.triggers) await runTriggers(psu.triggers, value);
        } catch (err) {
            reject(err);
        }
    });
}

function getLight(lightIndex) {
    return new Promise(async (resolve, reject) => {
        try {
            const light = config.lights[lightIndex];
    
            resolve({
                state: getGpioValue(light.gpio)
            });
        } catch (err) {
            reject(err);
        }
    });
}

function setLight(lightIndex, value) {
    return new Promise(async (resolve, reject) => {
        try {
            const light = config.lights[lightIndex];
    
            setGpio(light.gpio, value);
            
            resolve();
    
            console.log("[Light]", `${light.name ? `${light.name} (${lightIndex})` : lightIndex} turned ${value ? "on" : "off"}`);
    
            if (light.triggers) await runTriggers(light.triggers, value);
        } catch (err) {
            reject(err);
        }
    });
}

function getCamera(cameraIndex) {
    return new Promise(async (resolve, reject) => {
        try {
            const camera = config.cameras[cameraIndex];
            
            const cameraStream = cameraStreams[cameraIndex];
            
            resolve({
                state: cameraStream.state,
                startDate: cameraStream.startDate,
            });
        } catch (err) {
            reject(err);
        }
    });
}

function setCamera(cameraIndex, value) {
    return new Promise(async (resolve, reject) => {
        try {
            const camera = config.cameras[cameraIndex];
            
            cameraStreams[cameraIndex][value ? "start" : "stop"]();
            
            resolve();
            
            console.log("[Camera]", `${camera.name ? `${camera.name} (${cameraIndex})` : cameraIndex} turned ${value ? "on" : "off"}`);
            
            if (camera.triggers) await runTriggers(camera.triggers, value);
        } catch (err) {
            reject(err);
        }
    });
}

function clientSend(data, client) {
    if (client.writing) {
        return client.queue.push(data);
    } else {
        if (!client.res.write(data)) {
            client.writing = true;
            client.res.once("drain", () => {
                client.writing = false;
                if (client.queue.length) clientSend(client.queue.shift(), client);
            });
        } else {
            if (client.queue.length) clientSend(client.queue.shift(), client);
        }
    }
}

function createMultipartFrame(frame) {
    return Buffer.concat([
        Buffer.from(`--stream\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.byteLength}\r\n\r\n`),
        frame,
        Buffer.from("\r\n\r\n")
    ]);
}

// Camera streams

if (config.cameras) for (const cameraIndex in config.cameras) {
    const camera = config.cameras[cameraIndex];
    const cameraStream = new CameraStream(camera, {
        ffmpegInputArgs: camera.inputArgs,
        ffmpegOutputArgs: camera.outputArgs,
        storeLastFrame: camera.storeLastFrame,
        logs: true
    });

    cameraStream.start();

    cameraStream.on("start", () => {
        console.log("[Camera]", `${camera.name ? `${camera.name} (${cameraIndex})` : cameraIndex} started`);
    });

    cameraStream.on("frame", frame => {
        const multipartFrame = createMultipartFrame(frame);

        for (const cameraClient of cameraClients[cameraIndex]) cameraClient.send(multipartFrame);
    });

    cameraStream.on("close", () => {
        console.log("[Camera]", `${camera.name ? `${camera.name} (${cameraIndex})` : cameraIndex} closed`);
    });

    cameraStream.on("error", err => {
        console.log("[Camera]", `${camera.name ? `${camera.name} (${cameraIndex})` : cameraIndex} had an error:`, err);
        if (config.cameraRetryInterval) setTimeout(() => {
            if (cameraStream.state === 2) cameraStream.start()
        }, config.cameraRetryInterval);
    });

    cameraStreams[cameraIndex] = cameraStream;
    cameraClients[cameraIndex] = [];
}
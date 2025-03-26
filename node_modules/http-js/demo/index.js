const port = 8080;
const Server = require("../Server");
const WS = require("../WS");

server = new Server({
    routerOptions: [
        { ignoreRoot: ["/api"] }, // TODO: automate this pls lol
        { root: "/api" }
    ]
});

[appRouter, apiRouter] = server.routers;

appRouter.get("/ws", (req, res) => {
    console.log(2)
    const socket = new WS(req, res);
});

require("./app");
require("./api");

server.listen(port, () => console.log(`Listening at :${port}`));
const Server = require("./Server");

const server = new Server();

server.get("/", (req, res) => {
    console.log(`${req.ip} visiting ${req.path}, query: ${JSON.stringify(req.query)}, params: ${JSON.stringify(req.params)}`);
    res.html("<center>hi</center>");
    // res.json({ hello: "world" });
    // res.send("Hi");
});

server.get("/test", (req, res) => {
    console.log(res.writeLarge("hi"));
    console.log(res.writeLarge("hi"));
    console.log(res.writeLarge("hi".repeat(5000000)));
    console.log(res.writeLarge("hi"));
    console.log(res.writeLarge("hi".repeat(5000000)));
    console.log(res.writeLarge("hi"));
    console.log(res.writeLarge("hi"));
});

// server.get("/:{thisIsBroken}.txt/", (req, res, next, params) => {
//     console.log(params)
//     res.send("hi")
// });
// console.log(server.router)

server.get("/:thing", (req, res, next, params) => {
    res.html(`<center>${decodeURIComponent(params.thing)}</center>`);
});

server.listen(6969, () => console.log("Listening <http://localhost:6969>"));
























// TESTS
const Router = require("./Router");
if ([
    Router.createPathRegex("/hello/world").test("/hello/worldworld") === false,
    Router.createPathRegex("/hello/world").test("/hello/world/") === true,
    Router.createPathRegex("/hello/world").test("/hello/world/world") === true,
    Router.createPathRegex("/hello/world").test("/hello/world") === true,
    Router.createPathRegex("/hello/world/").test("/hello/world/world") === false,
    Router.createPathRegex("/hello/world/").test("/hello/world/") === true,
    Router.createPathRegex("/hello/world/*").test("/hello/world/hi/hi") === true,
    Router.createPathRegex("/hello/world/*/").test("/hello/world/hi/hi") === false,
    Router.createPathRegex("/hello/world/*/:a").test("/hello/world/hi/hi") === true,
    Router.createPathRegex("/hello/world/*/:a").test("/hello/world/hi/hi/hi") === true,
    Router.createPathRegex("/hello/world/*/:a/").test("/hello/world/hi/hi/hi") === false,
    Router.createPathRegex("/hello/world/*/:{a}/").test("/hello/world/hi/hi/") === true,
    Router.createPathRegex("/hello/world/*/:{}/").test("/hello/world/hi/hi/") === false,
    Router.createPathRegex("/hello/world/*/:{}/").test("/hello/world/hi/:{}/") === true,
    Router.createPathRegex("/hello/world/\\*/").test("/hello/world/*") === true,
    Router.createPathRegex("/hello/world/\\:test/").test("/hello/world/:test") === true,
    Router.createPathRegex("/hello/world/\\:{test}/").test("/hello/world/:{test}") === true,
].includes(false)) console.log("FAILED TESTS")
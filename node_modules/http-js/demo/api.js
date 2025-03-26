apiRouter.get("/", (req, res) => {
    res.json("This is a API!");
});

apiRouter.get("/status/", (req, res) => {
    res.json({ working: true });
});

apiRouter.any("*", (req, res) => {
    res.json({ error: "404" });
});
appRouter.get(["/", "/home/"], (req, res) => {
    res.html("<center>home</center>")
});

appRouter.get("/about/", (req, res) => {
    res.html("<center>about</center>");
});

appRouter.any("*", (req, res) => {
    res.html("404");
});
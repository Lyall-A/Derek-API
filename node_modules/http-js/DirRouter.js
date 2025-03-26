// TODO: really shit and rushed
const fs = require("fs");
const path = require("path");

const { objectDefaults } = require("./utils");

class DirRouter {
    constructor(dirPath, router, options) {
        this._options = objectDefaults(options, {
            fileSubstitutes: {
                "index.html": ""
            },
            extMimes: {
                ".html": "text/html",
                ".css": "text/css",
                ".js": "text/javascript",
                ".png": "image/png",
                ".jpg": "image/jpeg",
                ".jpeg": "image/jpeg",
                ".gif": "image/gif",
                ".webp": "image/webp",
            },
            dontPreload: false,
            watchFile: false
        });

        const routeDir = (dirPath, parent = "/") => {
            const files = fs.readdirSync(dirPath);
            for (const file of files) {
                const filePath = path.join(dirPath, file);
                const isDir = fs.lstatSync(filePath).isDirectory();
                if (isDir) {
                    routeDir(filePath, parent + `${file}/`);
                } else {
                    const ext = path.extname(file);
                    const fileSub = this._options.fileSubstitutes[file];
                    const routePath = `${parent}${typeof fileSub === "string" ? (fileSub ? `${fileSub}/` : "") : `${file}/`}`;
                    let fileContent = this._options.dontPreload ? null : fs.readFileSync(filePath);
                    if (fileContent && this._options.watchFile) fs.watchFile(filePath, () => fileContent = fs.readFileSync(filePath));
                    // console.log(routePath);
                    router.get(routePath, (req, res) => res.send(fileContent || fs.readFileSync(filePath), this._options.extMimes[ext]));
                }
            }
        };
        routeDir(dirPath);
    }
}

module.exports = DirRouter;
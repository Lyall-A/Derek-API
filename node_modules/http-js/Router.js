const http = require("http");

const { escapeRegex, objectDefaults } = require("./utils");

class Router {
    constructor(options) {
        this._options = objectDefaults(options, {
            ignoreRepeatedSlashes: true,
            server: null,
            root: null,
            ignoreRoot: null
        });
        this._listeners = [];

        if (this._options.server) this._options.server?.on("request", this.route);
    }

    route = async (req, res) => {
        const path = this.getPath(req.url);
        if (this._options.ignoreRoot && (this._options.ignoreRoot instanceof Array ? this._options.ignoreRoot.find(i => path.match(new RegExp(i instanceof RegExp ? i.source : Router.createPathRegex(i)))) : path.match(new RegExp(this._options.ignoreRoot instanceof RegExp ? this._options.ignoreRoot.source : Router.createPathRegex(this._options.ignoreRoot))))) return;
        const listeners = this._listeners.filter(i => i && (!i.method || i.method === req.method));

        for (const listener of listeners) {
            const match = path.match(listener.regex);
            if (!match) continue;
            const params = Router.getParams(match, listener);
            let next = false;
            await listener.handler(req, res, () => next = true, params, listener);
            if (next) continue; else break;
        }
    }

    any = this.createMethod();
    get = this.createMethod("get");
    head = this.createMethod("head");
    post = this.createMethod("post");
    put = this.createMethod("put");
    delete = this.createMethod("delete");
    connect = this.createMethod("connect");
    options = this.createMethod("options");
    trace = this.createMethod("trace");
    patch = this.createMethod("patch");

    createMethod(method) {
        /**
         * Listens for requests
         * @param {string} path URL path
         * @param {(req: http.IncomingMessage, res: http.ServerResponse, next: () => void, params: object, listener: object) => void} handler Listener handler
         */
        return (path, handler) => {
            const paths = path instanceof Array ? path : [path];
            const returns = [];
            for (let path of paths) {
                if (path === "*" || !path) path = Router.pathEnd; // Replace path with regex if equals '*'
                let regex = new RegExp(`${this._options.root ? this._options.root instanceof RegExp ? this._options.root.source : Router.createPathRegex(this._options.root, false, true).source : ""}${path instanceof RegExp ? path.source : Router.createPathRegex(path, this._options.root ? true : false).source}`);

                const listenerIndex = this._listeners.push({
                    path,
                    handler,
                    regex,
                    paramNames: [
                        ...Router.getParamNames(this._options.root),
                        ...Router.getParamNames(path)
                    ],
                    method: method?.toUpperCase()
                }) - 1;
                
                returns.push(() => this._listeners[listenerIndex] = null);
            }
            return typeof path === "object" ? returns : returns[0];
        }
    }

    getPath = (url) => {
        let path = url.split("?")[0];
        if (this._options.ignoreRepeatedSlashes) path = path.replace(/\/+/g, "/");
        return path;
    }

    static pathGroupRegex = /([^/]+)/;
    static pathRegex = /(?<any>\\\*)|:\\{(?<enclosed_param>.+?)\\}|:(?!\\{.*?\\})(?<param>[^/]+)/g;
    static pathEnd = /(?<end>$|\/.*)/;

    static createPathRegex = (path, noStart, noEnd) => {
        // NOTE: no trailing slash means that there can be paths after, eg. /hello will match /hello and /hello/WORLD/ANYTHING
    
        // /hello/world = /hello/world/ANY/THING
        // /hello/world/ = /hello/world
        // /hello/*/ = /hello/ANYTHING
        // /hello/hi-*/ = /hello/hi-ANYTHING
        // /hello/hi-*-hru/ = /hello/hi-ANYTHING-hru
        // /hello/:name/ = /hello/ANYTHING (with "name" parameter)
        // /hello/hi-:{name}-hru/ = /hello/hi-ANYTHING-hru (with "name" parameter)
        // /hello/hi-:name/ = /hello/hi-ANYTHING (with "name" parameter)
        
        return new RegExp(`${!noStart ? "^" : ""}${escapeRegex(path).replace(this.pathRegex, this.pathGroupRegex.source)}${!noEnd ? path.endsWith("/") ? "?$" : this.pathEnd.source : ""}`.replace(/\\\\/g, ""));
    }

    static getParamNames = (path) => {
        if (typeof path !== "string") return [ ];
        return Array.from(escapeRegex(path).matchAll(this.pathRegex)).map(i => i.groups.param || i.groups.enclosed_param || null);
    }

    static getParams = (match, listener) => {
        if (typeof listener.path !== "string") return { };
        const groups = match.slice(1);
        return Object.fromEntries(listener.paramNames.map((name, index) => name !== null ? [name, groups[index]] : null).filter(i => i !== null));
    }
}

module.exports = Router;
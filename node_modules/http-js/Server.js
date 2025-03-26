const http = require("http");
const https = require("https");

const { objectDefaults } = require("./utils");
const request = require("./request");
const response = require("./response");
const Router = require("./Router");

class Server {
    constructor(options) {
        this._options = objectDefaults(options, {
            server: null, // The HTTP server
            router: null, // The router for the server
            routerOptions: null, // Router options, can be array to create multiple routers
            serverOptions: null, // Server options
            noRouter: false, // Don't create router
            noRequestEvent: false, // Don't create the request event for router
            noCustomRoute: false, // Don't create custom route for every request
            tls: false, // Enable TLS for HTTPS
            key: null, // Key for HTTPS
            cert: null // Cert for HTTPS
        });

        this.server = this._options.server || ((this._options.tls && this._options.key && this._options.cert) ? https : http).createServer({ key: this._options.key, cert: this._options.cert, ...this._options.serverOptions });
        this.router = this._options.router;
        this.routers = [this.router];

        if (!this.router && !this._options.noRouter) {
            if (this._options.routerOptions instanceof Array) {
                // Create multiple routers, 1st being this.router
                this._options.routerOptions.forEach((routerOptions, index) => {
                    const router = new Router(routerOptions);
                    if (!index) {
                        this.router = router;
                        this.routers = [this.router];
                    } else this.routers.push(router);
                    // Setup router
                    if (!this._options.noRequestEvent) this.createRequestEvent(router);
                    // Modify req and res
                    if (!this._options.noCustomRoute) this.createCustomRoute(router);
                });
            } else {
                // Create 1 router
                this.router = new Router(this._options.routerOptions);
                this.routers = [this.router];
                // Setup router
                if (!this._options.noRequestEvent && this.router) this.createRequestEvent();
                // Modify req and res
                if (!this._options.noCustomRoute && this.router) this.createCustomRoute();
            }
        }
    }

    // Router
    any = (...args) => this.router.any(...args);
    get = (...args) => this.router.get(...args);
    head = (...args) => this.router.head(...args);
    post = (...args) => this.router.post(...args);
    put = (...args) => this.router.put(...args);
    delete = (...args) => this.router.delete(...args);
    connect = (...args) => this.router.connect(...args);
    options = (...args) => this.router.options(...args);
    trace = (...args) => this.router.trace(...args);
    patch = (...args) => this.router.patch(...args);

    // Server
    on = (...args) => this.server.on(...args);
    once = (...args) => this.server.once(...args);
    listen = (...args) => this.server.listen(...args);

    // Others
    createRequestEvent(router = this.router) {
        this.server.on("request", router.route);
    }

    createCustomRoute(router = this.router) {
        router.any("*", (req, res, next) => {
            request.apply(req, req);
            response.apply(res, res);
            next();
        });
    }
}

module.exports = Server;
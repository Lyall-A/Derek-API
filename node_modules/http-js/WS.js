class WS {
    constructor(req, res) {
        this._req = req;
        this._res = res;
        console.log(req.headers);
    }
}

module.exports = WS;
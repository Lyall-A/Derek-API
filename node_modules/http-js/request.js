function parse(raw) {
    const parsed = { };

    parsed.ip = raw.socket.remoteAddress?.split("::ffff:")[1] || raw.socket.remoteAddress;
    parsed.path = raw.url?.split("?")[0];
    parsed.query = Object.fromEntries(raw.url?.split("?")[1]?.split("&").map(i => { const [key, value = ""] = i.split("="); return [key, value] }) || []);

    return parsed;
}

function apply(raw, x) {
    // x._raw = raw;
    x._parsed = parse(raw);

    Object.entries(x._parsed).forEach(([key, value]) => x[key] = value);
}

module.exports = {
    parse,
    apply
}
function parse(raw) {
    const parsed = { };

    parsed.setStatus = (status, message) => {
        if (status) raw.statusCode = status;
        if (message) raw.statusMessage = message;
        return parsed;
    }

    parsed.sendStatus = (status, message) => {
        if (status) raw.statusCode = status;
        if (message) raw.statusMessage = message;
        raw.end();
        return parsed;
    }

    parsed.redirect = (location, permanent) => {
        raw.statusCode = permanent ? 301 : 302;
        raw.setHeader("Location", location);
        raw.end();
        return parsed;
    }

    parsed.send = (data, contentType = "text/plain") => {
        if (contentType) raw.setHeader("Content-Type", contentType);
        raw.end(data);
        return parsed;
    }

    parsed.json = (json, noContentType, noEnd) => {
        if (!noContentType) raw.setHeader("Content-Type", "application/json");
        raw[(!noEnd ? "end" : "write")](JSON.stringify(json));
        return parsed;
    }

    parsed.html = (html, noContentType, noEnd) => {
        if (!noContentType) raw.setHeader("Content-Type", "text/html");
        raw[(!noEnd ? "end" : "write")](html);
        return parsed;
    }

    parsed.nothing = () => {
        raw.end();
        return parsed;
    };

    parsed.writeQueue = [];
    parsed.writing = false;

    parsed.writeLarge = (chunk) => {
        if (parsed.writing) {
            parsed.writeQueue.push(chunk);
            return false;
        }

        if (!raw.write(chunk)) {
            parsed.writing = true;
            raw.once("drain", () => {
                parsed.writing = false;
                if (parsed.writeQueue.length) parsed.writeLarge(parsed.writeQueue.shift());
            });
            return false;
        } else {
            if (parsed.writeQueue.length) parsed.writeLarge(parsed.writeQueue.shift());
            return true;
        }
    }

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
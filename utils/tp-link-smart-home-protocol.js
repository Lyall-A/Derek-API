const net = require("net");

function sendSmartHomeProtocolCommand(address, command) {
    return new Promise((resolve, reject) => {
        const connection = net.createConnection({ host: address, port: 9999 });
        connection.write(smartHomeProtocolEncrypt(JSON.stringify(command)));
        let data;
        connection.on("data", i => data = Buffer.concat(data ? [data, i] : [i]));
        connection.on("end", () => resolve(JSON.parse(smartHomeProtocolDecrypt(data))));
        connection.on("error", err => reject(err));
    });
}

function smartHomeProtocolEncrypt(string) {
    let key = 171;
    const length = string.length;
    const result = new Uint8Array(4 + length);

    result[0] = (length >> 24) & 0xFF;
    result[1] = (length >> 16) & 0xFF;
    result[2] = (length >> 8) & 0xFF;
    result[3] = length & 0xFF;

    for (let i = 0; i < string.length; i++) {
        const a = key ^ string.charCodeAt(i);
        key = a;
        result[4 + i] = a;
    }

    return result;
}

function smartHomeProtocolDecrypt(array) {
    let key = 171;
    let result = "";

    for (let i = 4; i < array.length; i++) {
        const a = key ^ array[i];
        key = array[i];
        result += String.fromCharCode(a);
    }

    return result;
}

module.exports = {
    sendSmartHomeProtocolCommand,
    smartHomeProtocolEncrypt,
    smartHomeProtocolDecrypt
}
const fs = require("fs");

function setGpio(pin, value, direction = "output") {
    const writeDirection = `${direction === "output" ? "out" : direction === "input" ? "in" : "out"}\n`;
    const writeValue = `${value === false ? 0 :  value === true ? 1 : value}\n`;

    // Export pin
    if (!fs.existsSync(`/sys/class/gpio/gpio${pin}`)) {
        fs.writeFileSync("/sys/class/gpio/export", `${pin}\n`);
    }

    // Set direction
    if (fs.readFileSync(`/sys/class/gpio/gpio${pin}/direction`, "utf-8") !== writeDirection) {
        fs.writeFileSync(`/sys/class/gpio/gpio${pin}/direction`, `${writeDirection}`);
    }

    // Set value
    fs.writeFileSync(`/sys/class/gpio/gpio${pin}/value`, `${writeValue}`);
}

function getGpioValue(pin) {
    if (!fs.existsSync(`/sys/class/gpio/gpio${pin}`)) return null;
    return parseInt(fs.readFileSync(`/sys/class/gpio/gpio${pin}/value`, "utf-8"));
}

module.exports = {
    setGpio,
    getGpioValue
}
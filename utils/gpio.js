const fs = require("fs");

function setGpio(pin, value, direction = "output") {
    // Export pin
    if (!fs.existsSync(`/sys/class/gpio/gpio${pin}`)) {
        fs.writeFileSync("/sys/class/gpio/export", `${pin}`);
    }

    // Set direction
    const writeDirection = direction === "output" ? "out" : direction === "input" ? "in" : "out";
    if (fs.readFileSync(`/sys/class/gpio/gpio${pin}/direction`, "utf-8") !== writeDirection) {
        fs.writeFileSync(`/sys/class/gpio/gpio${pin}/direction`, writeDirection);
    }
    
    // Set value
    fs.writeFileSync(`/sys/class/gpio/gpio${pin}/value`, `${value === false ? 0 :  value === true ? 1 : value}`);
}

function getGpioValue(pin) {
    if (!fs.existsSync(`/sys/class/gpio/gpio${pin}`)) return null;
    fs.writeFileSync(`/sys/class/gpio/gpio${pin}/direction`, `out`);
    return parseInt(fs.readFileSync(`/sys/class/gpio/gpio${pin}/value`, "utf-8"));
}

module.exports = {
    setGpio,
    getGpioValue
}
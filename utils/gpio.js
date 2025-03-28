const fs = require("fs");

const pinValues = { }; // In my case reading the value of a pin sets the value to 0, so we are just storing the values here

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
    const writeValue = value === false ? 0 :  value === true ? 1 : value;
    fs.writeFileSync(`/sys/class/gpio/gpio${pin}/value`, `${writeValue}`);
    pinValues[pin] = writeValue;
}

function getGpioValue(pin) {
    return pinValues[pin] ?? null;
    // if (!fs.existsSync(`/sys/class/gpio/gpio${pin}`)) return null;
    // return parseInt(fs.readFileSync(`/sys/class/gpio/gpio${pin}/value`, "utf-8"));
}

module.exports = {
    setGpio,
    getGpioValue
}
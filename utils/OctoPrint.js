class OctoPrint {
    constructor(baseUrl, apiKey) {
        this.baseUrl = baseUrl;
        this.apiKey = apiKey;
    }

    async fetch(path, options = { }) {
        return fetch(`${this.baseUrl}${path}`, {
            ...options,
            headers: {
                "X-Api-Key": this.apiKey,
                ...options.headers
            },
            body: options.body ? JSON.stringify(options.body) : undefined
        }).then(async i => ({
            status: i.status,
            json: await i.json().catch(err => null)
        }));
    }

    sendCommand(command) {
        return this.fetch("/api/printer/command", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: { command }
        });
    }

    setJob(job) {
        return this.fetch("/api/job", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: job
        });
    }

    getJob() {
        return this.fetch("/api/job");
    }
}

module.exports = OctoPrint;
'use strict';

// Only the Folia main window's main frame may reach the companion channel.
function createCompanionRequestHandler({ isTrusted, client }) {
    return (event, operation, params) => {
        if (!isTrusted(event.sender) || !event.senderFrame || event.senderFrame !== event.sender.mainFrame) {
            return { ok: false, error: 'unavailable' };
        }
        return client.request(operation, params);
    };
}

module.exports = { createCompanionRequestHandler };

let funscriptActions = [];

export function loadFunscript(funscriptUrl) {
    fetch(funscriptUrl)
        .then(response => response.json())
        .then(data => {
            funscriptActions = data.actions || [];
        })
        .catch(error => {
            console.error('Failed to load funscript:', error);
            funscriptActions = [];
        });
}

export function getCurrentFunscriptAction(currentTime) {
    for (let i = funscriptActions.length - 1; i >= 0; i--) {
        if (funscriptActions[i].at <= currentTime) {
            return funscriptActions[i];
        }
    }
    return null;
}
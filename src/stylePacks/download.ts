// Object URLs are short-lived and shared by the standalone tool and in-app manager.
export function downloadStyleFile(name: string, content: string | Blob, type = 'application/json') {
    const url = URL.createObjectURL(typeof content === 'string' ? new Blob([content], { type }) : content);
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = name;
    document.body.appendChild(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

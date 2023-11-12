(async () => {
    const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

    try {
        const response = await fetch('http://localhost:5000/__browser_sync__?method=reload');
        if (response.ok) {
            console.log('Browser-sync triggered');
        } else {
            throw new Error('Failed to trigger browser-sync');
        }
    } catch (err) {
        console.error('Failed to trigger browser-sync:', err);
    }
})();

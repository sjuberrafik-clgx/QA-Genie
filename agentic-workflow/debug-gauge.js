const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ viewport: { width: 800, height: 600 } });
    const page = await ctx.newPage();

    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', msg => console.log('BROWSER:', msg.type(), msg.text()));

    const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body>
<canvas id="c" width="400" height="400"></canvas>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"></script>
<script>
(function(){
    try {
        var config = {
            type: "doughnut",
            data: { datasets: [{ data: [87, 13], backgroundColor: ["#22C55ECC", "#E5E7EB33"], borderWidth: 0 }] },
            options: { responsive: false, maintainAspectRatio: false, animation: false, circumference: 270, rotation: -135, cutout: "75%", plugins: { legend: { display: false }, tooltip: { enabled: false } } }
        };
        config.plugins = [{
            id: "gaugeCenter",
            afterDraw: function(chart) {
                var x = chart.ctx;
                x.save();
                x.textAlign = "center";
                x.fillStyle = "#1F2937";
                x.font = "bold 36px sans-serif";
                x.fillText("87%", chart.width / 2, chart.height / 2 + 5);
                x.restore();
            }
        }];
        var cx = document.getElementById("c").getContext("2d");
        new Chart(cx, config);
        window.__chartDone = true;
    } catch (e) {
        window.__chartError = e.message;
        window.__chartDone = true;
    }
})();
</script>
</body>
</html>`;

    await page.setContent(html, { waitUntil: 'networkidle' });

    const done = await page.evaluate(() => window.__chartDone);
    const err = await page.evaluate(() => window.__chartError);
    console.log('done:', done, 'err:', err);
    console.log('page errors:', errors);

    await browser.close();
})();

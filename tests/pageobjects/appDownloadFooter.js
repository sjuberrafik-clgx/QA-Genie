class AppDownloadFooter {
    constructor(page) {
        this.page = page;
    }

    get footer() {
        return this.page.locator('footer[role="contentinfo"]');
    }

    get downloadSection() {
        return this.footer.locator('aotf-app-download-qr-code');
    }

    get downloadHeading() {
        return this.footer.getByRole('heading', { name: 'Download the OneHome App', exact: true });
    }

    get qrCodeCanvas() {
        return this.downloadSection.locator('canvas');
    }

    get appStoreLink() {
        return this.downloadSection.locator('a[href*="apps.apple.com"]');
    }

    get googlePlayLink() {
        return this.downloadSection.locator('a[href*="play.google.com"]');
    }

    get appStoreTile() {
        return this.appStoreLink.locator('img[alt="Download on the App Store"]');
    }

    get googlePlayTile() {
        return this.googlePlayLink.locator('img[alt="Get it on Google Play"]');
    }
}

module.exports = AppDownloadFooter;

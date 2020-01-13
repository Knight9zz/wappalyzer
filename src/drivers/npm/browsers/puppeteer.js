const puppeteer = require('puppeteer');
const Browser = require('../browser');

function getJs() {
  const dereference = (obj, level = 0) => {
    try {
      // eslint-disable-next-line no-undef
      if (level > 5 || (level && obj === window)) {
        return '[Removed]';
      }

      if (Array.isArray(obj)) {
        obj = obj.map(item => dereference(item, level + 1));
      }

      if (typeof obj === 'function' || (typeof obj === 'object' && obj !== null)) {
        const newObj = {};

        Object.keys(obj).forEach((key) => {
          newObj[key] = dereference(obj[key], level + 1);
        });

        return newObj;
      }

      return obj;
    } catch (error) {
      return undefined;
    }
  };

  // eslint-disable-next-line no-undef
  return dereference(window);
}

class PuppeteerBrowser extends Browser {
  constructor(options) {
    options.maxWait = options.maxWait || 60;

    super(options);

    this.browser = () => puppeteer.launch({
      executablePath: process.env.CHROME_BIN,
      args: ['--no-sandbox', '--headless', '--disable-gpu', '--ignore-certificate-errors'],
    });
  }

  async visit(url) {
    let browser;

    try {
      browser = await this.browser();
    } catch (error) {
      throw new Error(error.message || error.toString());
    }

    browser.on('disconnected', () => {
      throw new Error('Disconnected');
    });

    try {
      const page = await browser.newPage();

      page.setDefaultTimeout(this.options.maxWait);

      await page.setRequestInterception(true);

      page.on('error', (error) => {
        throw new Error(error.message || error.toString());
      });

      page.on('request', request => request.continue());

      page.on('response', (response) => {
        if (response.status() === 301 || response.status() === 302) {
          return;
        }

        if (!this.statusCode) {
          this.statusCode = response.status();

          this.headers = {};

          const headers = response.headers();

          Object.keys(headers).forEach((key) => {
            this.headers[key] = Array.isArray(headers[key]) ? headers[key] : [headers[key]];
          });

          this.contentType = headers['content-type'] || null;
        }
      });

      page.on('console', ({ _type, _text, _location }) => this.log(`${_text} (${_location.url}: ${_location.lineNumber})`, _type));

      await page.setUserAgent(this.options.userAgent);

      await Promise.race([
        page.goto(url, { waitUntil: 'networkidle2' }),
        new Promise(resolve => setTimeout(resolve, this.options.maxWait)),
      ]);

      // eslint-disable-next-line no-undef
      const links = await page.evaluateHandle(() => Array.from(document.getElementsByTagName('a')).map(({
        hash, hostname, href, pathname, protocol, rel,
      }) => ({
        hash,
        hostname,
        href,
        pathname,
        protocol,
        rel,
      })));

      this.links = await links.jsonValue();

      // eslint-disable-next-line no-undef
      const scripts = await page.evaluateHandle(() => Array.from(document.getElementsByTagName('script')).map(({
        src,
      }) => src));

      this.scripts = (await scripts.jsonValue()).filter(script => script);

      this.js = await page.evaluate(getJs);

      this.cookies = (await page.cookies()).map(({
        name, value, domain, path,
      }) => ({
        name, value, domain, path,
      }));

      this.html = await page.content();
    } catch (error) {
      throw new Error(error.message || error.toString());
    } finally {
      await browser.close();
    }
  }
}

module.exports = PuppeteerBrowser;

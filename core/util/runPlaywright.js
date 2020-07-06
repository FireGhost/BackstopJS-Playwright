const playwright = require('playwright');

const ensureDirectoryPath = require('./ensureDirectoryPath');
const engineTools = require('./engineTools');
const chalk = require('chalk');
const path = require('path');
const fs = require('./fs');

const TEST_TIMEOUT = 60000;
const DEFAULT_FILENAME_TEMPLATE = '{configId}_{scenarioLabel}_{selectorIndex}_{selectorLabel}_{viewportIndex}_{viewportLabel}_{browserTypeIndex}_{browserTypeLabel}';
const DEFAULT_BITMAPS_TEST_DIR = 'bitmaps_test';
const DEFAULT_BITMAPS_REFERENCE_DIR = 'bitmaps_reference';

module.exports = function (args) {
  const scenario = args.scenario;
  const viewport = args.viewport;
  const config = args.config;
  const browserType = args.browserType;
  const scenarioViewId = args.id;
  const scenarioLabelSafe = engineTools.makeSafe(scenario.label);
  const variantOrScenarioLabelSafe = scenario._parent ? engineTools.makeSafe(scenario._parent.label) : scenarioLabelSafe;

  config._bitmapsTestPath = config.paths.bitmaps_test || DEFAULT_BITMAPS_TEST_DIR;
  config._bitmapsReferencePath = config.paths.bitmaps_reference || DEFAULT_BITMAPS_REFERENCE_DIR;
  config._fileNameTemplate = config.fileNameTemplate || DEFAULT_FILENAME_TEMPLATE;
  config._outputFileFormatSuffix = '.' + ((config.outputFormat && config.outputFormat.match(/jpg|jpeg/)) || 'png');
  config._configId = config.id || engineTools.genHash(config.backstopConfigFileName);

  return processScenariosBrowsersView(scenario, variantOrScenarioLabelSafe, scenarioLabelSafe, viewport, config, browserType, scenarioViewId);
};

async function processScenariosBrowsersView (scenario, variantOrScenarioLabelSafe, scenarioLabelSafe, viewport, config, browserType, scenarioViewId) {
  const isReference = config.isReference;

  const engineScriptsPath = config.env.engine_scripts || config.env.engine_scripts_default;

  // Init browser and new page.
  const launchArgs = Object.assign(
    {},
    config.engineOptions
  );
  const browser = await playwright[browserType.label].launch(launchArgs);
  const page = await browser.newPage({
    ignoreHTTPSErrors: true
  });

  page.setDefaultNavigationTimeout(engineTools.getEngineOption(config, 'waitTimeout', TEST_TIMEOUT));

  const VP_W = viewport.width || viewport.viewport.width;
  const VP_H = viewport.height || viewport.viewport.height;
  await page.setViewportSize({ width: VP_W, height: VP_H });

  // Info for user.
  if (isReference) {
    console.log(chalk.blue('CREATING NEW REFERENCE FILE'));
  } else {
    console.log(chalk.blue('CREATING TEST FILE'));
  }

  // Redirect browser console message to user console.
  if (!config.hideBrowserConsoleLogs) {
    page.on('console', (message) => {
      console.log('Browser Console Log:');
      console.log(message);
    });
  }

  // Call the onBefore script.
  const onBeforeScript = scenario.onBeforeScript || config.onBeforeScript;
  if (onBeforeScript) {
    const beforeScriptPath = path.resolve(engineScriptsPath, onBeforeScript);
    if (fs.existsSync(beforeScriptPath)) {
      await require(beforeScriptPath)(page, scenario, viewport, isReference, browser, config, browserType);
    } else {
      console.warn(chalk.yellow('WARNING: script not found: ' + beforeScriptPath));
    }
  }

  // Go to page.
  let url = scenario.url;
  if (isReference && scenario.referenceUrl) {
    url = scenario.referenceUrl;
  }
  await page.goto(url);

  // Wait for the specific console message.
  const readyEvent = scenario.readyEvent || config.readyEvent;
  if (readyEvent) {
    await page.waitForEvent('console', (message) => {
      return message === readyEvent;
    });
  }

  // Wait for a specific selector
  if (scenario.readySelector) {
    await page.waitForSelector(scenario.readySelector);
  }

  // Wait a specific amount of time.
  if (scenario.delay > 0) {
    await page.waitForTimeout(scenario.delay);
  }

  // Call the onReady script.
  const onReadyScript = scenario.onReadyScript || config.onReadyScript;
  if (onReadyScript) {
    const readyScriptPath = path.resolve(engineScriptsPath, onReadyScript);
    if (fs.existsSync(readyScriptPath)) {
      await require(readyScriptPath)(page, scenario, viewport, isReference, browser, config, browserType);
    } else {
      console.warn(chalk.yellow('WARNING: script not found: ' + readyScriptPath));
    }
  }

  // Init files paths.
  // TODO: Multi selectors !
  const currentTestPair = engineTools.generateTestPair(config, scenario, viewport, variantOrScenarioLabelSafe, scenarioLabelSafe, 0, 'document', browserType);
  const currentFilePath = isReference ? currentTestPair.reference : currentTestPair.test;
  ensureDirectoryPath(currentFilePath);

  console.log(chalk.green(`Say cheese: ${currentFilePath}`));
  await page.screenshot({
    path: (currentFilePath),
    fullPage: true
  });
  await browser.close();
  console.log(chalk.blue(`X Closed browser ${scenarioViewId}`));

  const compareConfig = { testPairs: [] };
  if (!isReference) {
    compareConfig.testPairs.push(currentTestPair);
  }
  return Promise.resolve(compareConfig);
}

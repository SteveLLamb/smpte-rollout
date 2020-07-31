/*
Copyright (c), Steve LLamb

This work is licensed under the Creative Commons Attribution 4.0 International License.

You should have received a copy of the license along with this work.  If not, see <https://creativecommons.org/licenses/by/4.0/>.
*/

/* pass the option --nopdf to disable PDF creation */

const path = require('path');
const fs = require('fs').promises;
const { promisify } = require('util');
const execFile = promisify(require('child_process').execFile);
const hb = require('handlebars');
const puppeteer = require('puppeteer');
const ajv = require('ajv');

const REGISTRIES_REPO_PATH = "src/main";
const SITE_PATH = "src/site";
const BUILD_PATH = "build";

/* list the available registries type (lower case), id (single, for links), titles (Upper Case), and schema builds */

const registries = [
  {
    "listType": "countries",
    "templateType": "countries",
    "idType": "country",
    "listTitle": "Countries"
  },
  {
    "listType": "regions",
    "templateType": "regions",
    "idType": "region",
    "listTitle": "Regions"
  }
]

/* load and build the templates */

async function buildRegistry ({ listType, templateType, idType, listTitle }) {
  
  console.log(`Building ${templateType} started`)

  var DATA_PATH = path.join(REGISTRIES_REPO_PATH, "data/" + listType + ".json");
  var DATA_SCHEMA_PATH = path.join(REGISTRIES_REPO_PATH, "schemas/" + listType + ".schema.json");
  var TEMPLATE_PATH = "src/main/templates/" + templateType + ".hbs";
  var PAGE_SITE_PATH = templateType + ".html";
  var PDF_SITE_PATH = templateType + ".pdf";
  var CSV_SITE_PATH = templateType + ".csv";

  /* load header and footer for templates */

  hb.registerPartial('header', await fs.readFile("src/main/templates/partials/header.hbs", 'utf8'));
  hb.registerPartial('footer', await fs.readFile("src/main/templates/partials/footer.hbs", 'utf8'));

  /* instantiate template */
  
  let template = hb.compile(
    await fs.readFile(
      TEMPLATE_PATH,
      'utf8'
    )
  );
  
  if (!template) {
    throw "Cannot load HTML template";
  }
  
  /* load and validate the registry */

  let registry = JSON.parse(
    await fs.readFile(DATA_PATH)
  );
  
  if (!registry) {
    throw "Cannot load registry";
  }
  
  console.log(`${listTitle} schema validation started`)

  var validator_factory = new ajv();

  let validator = validator_factory.compile(
    JSON.parse(await fs.readFile(DATA_SCHEMA_PATH))
  );
  
  if (! validator(registry)) {
    console.log(validator.errors);
    throw "Registry fails schema validation";
  }
  else {
    console.log(`${listTitle} schema validation passed`)
  };

  /* calc the region counts and percentages */

  if (listType == "regions") {

    var COUNTRIES_PATH = "src/main/data/countries.json"
    let countries = JSON.parse(
      await fs.readFile(
        COUNTRIES_PATH
      )
    );
    
    if (!countries) {
      throw "Cannot load countries";  
    }

    for (let i in registry) {
      let rg = registry[i]["region"];
      let countriesFiltered = countries.filter(value => value.region === rg);
      let cC = countriesFiltered.length;
      
      let stsum = 0; 
      countriesFiltered.forEach(obj => {
          for (let p in obj) {
              if(p == "siteCount")
              stsum += obj[p];
          }
      })

      let spsum = 0; 
      countriesFiltered.forEach(obj => {
          for (let p in obj) {
              if(p == "smpteSite")
              spsum += obj[p];
          }
      })

      function round(value, decimals) {
        return Number(Math.round(value + 'e' + decimals) + 'e-' + decimals);
      }

      var spavg = round((spsum/cC), 2);

      registry[i].countryCount = cC;
      registry[i].siteCount = stsum;
      registry[i].smpteSite = spavg;
    }
  }
  
  /* get the version field */
  
  let site_version = "Unknown version"
  
  try {
    site_version = (await execFile('git', [ 'rev-parse', 'HEAD' ])).stdout.trim()
  } catch (e) {
    console.warn(e);
  }
  
  /* create build directory */
  
  await fs.mkdir(BUILD_PATH, { recursive: true });
  
  /* apply template */
  
  var html = template({
    "data" : registry,
    "date" :  new Date(),
    "pdf_path": PDF_SITE_PATH,
    "csv_path": CSV_SITE_PATH,
    "site_version": site_version,
    "listType": listType,
    "idType": idType,
    "listTitle": listTitle
  });
  
  /* write HTML file */
  
  await fs.writeFile(path.join(BUILD_PATH, PAGE_SITE_PATH), html, 'utf8');
  
  /* copy in static resources */
  
  await Promise.all((await fs.readdir(SITE_PATH)).map(
    f => fs.copyFile(path.join(SITE_PATH, f), path.join(BUILD_PATH, f))
  ))
  
  /* write pdf */
  
  if (process.argv.slice(2).includes("--nopdf")) return;
  
  /* set the CHROMEPATH environment variable to provide your own Chrome executable */
  
  var pptr_options = {};
  
  if (process.env.CHROMEPATH) {
    pptr_options.executablePath = process.env.CHROMEPATH;
  }
  
  try {
    var browser = await puppeteer.launch(pptr_options);
    var page = await browser.newPage();
    await page.setContent(html);
    await page.pdf({ path: path.join(BUILD_PATH, PDF_SITE_PATH).toString()});
    await browser.close();
  } catch (e) {
    console.warn(e);
  }

  /* write csv */

  function toCSV(registry) {
    var csv = "";
    var keys = (registry[0] && Object.keys(registry[0])) || [];
    csv += keys.join(',') + '\n';
    for (var line of registry) {
      csv += keys.map(key => line[key]).join(',') + '\n';
    }
    return csv;
  }

  try {
    await fs.writeFile((path.join(BUILD_PATH, CSV_SITE_PATH)), toCSV(registry));
  } catch (e) {
    console.warn(e);
  }

  console.log(`Build of ${templateType} completed`)
};

void (async () => {

  await Promise.all(registries.map(buildRegistry))

})().catch(console.error)

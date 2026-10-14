/**
 * URL import: JSON-LD variants, microdata, site adapters, entity/tag stripping.
 * Completely offline — every case runs against a hand-authored fixture page.
 */
import { describe, expect, test } from "bun:test";
import { cleanText, decodeHtmlEntities, stripTags } from "../../src/modules/recipe/services/import/html/entities.ts";
import { parseHtml, queryAll, textOf } from "../../src/modules/recipe/services/import/html/parse.ts";
import {
  buildIdIndex,
  extractJsonLd,
  findRecipeNodes,
  hasType,
  isNodeReference,
  parseJsonLdBlock,
  resolveNodeReferences,
  sanitizeJsonLd,
  typesOf,
} from "../../src/modules/recipe/services/import/url/jsonld.ts";
import { extractMicrodataItems, findMicrodataRecipe } from "../../src/modules/recipe/services/import/url/microdata.ts";
import { flattenInstructions, imageUrls, mapSchemaRecipe, scalar } from "../../src/modules/recipe/services/import/url/schema-map.ts";
import { extractRecipeFromHtml } from "../../src/modules/recipe/services/import/url/index.ts";
import { adapterForHost, adaptersFor, hostMatches } from "../../src/modules/recipe/services/import/url/adapters/index.ts";
import { fixture } from "./helpers.ts";

const CHEFKOCH_URL = "https://www.chefkoch.de/rezepte/1234567890/Klassische-Pfannkuchen.html";
const CHEFKOCH_GRAPH_URL =
  "https://www.chefkoch.de/rezepte/2133611343071438/Rote-Linsen-Curry-mit-Spaghetti.html";
const WPRM_URL = "https://biancazapatka.com/de/vegane-zimtschnecken/";
const GRAPH_URL = "https://kochblog.example/lasagne/";
const HOWTO_URL = "https://omas-kueche.example/kartoffelsuppe";
const MICRODATA_URL = "https://backstube-mueller.example/apfelkuchen";

describe("html entities + tag stripping", () => {
  test("decodes named, decimal and hex entities", () => {
    expect(decodeHtmlEntities("Br&ouml;tchen &amp; K&#228;se &#x2013; lecker")).toBe("Brötchen & Käse – lecker");
  });

  test("leaves unknown entities untouched instead of losing them", () => {
    expect(decodeHtmlEntities("&notarealentity; &amp;")).toBe("&notarealentity; &");
  });

  test("stripTags turns block boundaries into newlines and drops script bodies", () => {
    const html = "<ul><li>250 g Mehl</li><li>2 Eier</li></ul><script>var x = '<li>nope</li>';</script>";
    const text = stripTags(html);
    expect(text).toContain("250 g Mehl");
    expect(text).toContain("2 Eier");
    expect(text).not.toContain("nope");
    expect(text.split("\n").filter((line) => line.trim().length > 0)).toHaveLength(2);
  });

  test("cleanText collapses NBSP and removes inline markup", () => {
    expect(cleanText("<strong>250&nbsp;g</strong>\n  Mehl ")).toBe("250 g Mehl");
  });
});

describe("JSON-LD block parsing", () => {
  test("repairs trailing commas", () => {
    expect(parseJsonLdBlock('{"a":1,"b":[1,2,],}')).toEqual({ a: 1, b: [1, 2] });
  });

  test("repairs CDATA and comment wrappers", () => {
    expect(parseJsonLdBlock('/* <![CDATA[ */ {"a":1} /* ]]> */')).toEqual({ a: 1 });
    expect(parseJsonLdBlock('<!--{"a":1}-->')).toEqual({ a: 1 });
  });

  test("escapes raw newlines inside string values", () => {
    const repaired = sanitizeJsonLd('{"text":"Zeile 1\nZeile 2"}');
    expect(JSON.parse(repaired)).toEqual({ text: "Zeile 1\nZeile 2" });
  });

  test("returns undefined for hopeless input rather than throwing", () => {
    expect(parseJsonLdBlock("<<<not json>>>")).toBeUndefined();
    expect(parseJsonLdBlock("")).toBeUndefined();
  });

  test("typesOf handles a string, an array and a full schema.org URL", () => {
    expect(typesOf({ "@type": "Recipe" })).toEqual(["recipe"]);
    expect(typesOf({ "@type": ["Recipe", "NewsArticle"] })).toEqual(["recipe", "newsarticle"]);
    expect(typesOf({ "@type": "https://schema.org/Recipe" })).toEqual(["recipe"]);
    expect(hasType({ "@type": ["NewsArticle", "Recipe"] }, "Recipe")).toBe(true);
  });
});

describe("finding the Recipe node", () => {
  test("array of nodes (chefkoch style)", () => {
    const payloads = extractJsonLd(fixture("chefkoch-jsonld.html"));
    expect(payloads.length).toBeGreaterThan(0);
    const nodes = findRecipeNodes(payloads);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.name).toBe("Klassische Pfannkuchen");
  });

  test("@graph array (Yoast/WPRM style)", () => {
    const nodes = findRecipeNodes(extractJsonLd(fixture("biancazapatka-wprm.html")));
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.name).toBe("Vegane Zimtschnecken");
  });

  test("bare object", () => {
    const nodes = findRecipeNodes(extractJsonLd(fixture("howtostep-array.html")));
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.name).toBe("Deftige Kartoffelsuppe");
  });

  test("picks the node with the most ingredients when several exist", () => {
    const nodes = findRecipeNodes([
      { "@type": "Recipe", name: "Stub", recipeIngredient: ["1 Ei"] },
      { "@type": "Recipe", name: "Echt", recipeIngredient: ["1 Ei", "2 Mehl", "3 Milch"] },
    ]);
    expect(nodes[0]?.name).toBe("Echt");
  });

  test("ignores non-Recipe nodes in the graph", () => {
    const nodes = findRecipeNodes(extractJsonLd(fixture("graph-howtosection.html")));
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.name).toBe("Lasagne Bolognese");
  });
});

describe("@graph @id references", () => {
  test("isNodeReference is true only for an @id with no content beside it", () => {
    expect(isNodeReference({ "@id": "https://x/#img" })).toBe(true);
    expect(isNodeReference({ "@type": "ImageObject", "@id": "https://x/#img" })).toBe(true);
    expect(isNodeReference({ "@id": "https://x/#img", url: "https://x/a.jpg" })).toBe(false);
    expect(isNodeReference({ url: "https://x/a.jpg" })).toBe(false);
    expect(isNodeReference({ "@id": "  " })).toBe(false);
    expect(isNodeReference("https://x/#img")).toBe(false);
  });

  test("a reference-only node never shadows the definition in the index", () => {
    const index = buildIdIndex([
      { "@graph": [{ "@id": "#img" }, { "@type": "ImageObject", "@id": "#img", url: "https://a/b.jpg" }] },
    ]);
    expect(index.get("#img")?.url).toBe("https://a/b.jpg");
  });

  test("inlines image, publisher and author references", () => {
    const payloads = extractJsonLd(fixture("chefkoch-graph.html"));
    const node = findRecipeNodes(payloads)[0];
    const resolved = resolveNodeReferences(node as Record<string, unknown>, buildIdIndex(payloads));
    expect((resolved.image as { url?: string }).url).toBe(
      "https://img.chefkoch-cdn.de/rezepte/2133611343071438/bilder/1383229/crop-960x540/rote-linsen-curry.jpg",
    );
    expect((resolved.publisher as { name?: string }).name).toBe("Chefkoch");
    expect((resolved.author as { name?: string }).name).toBe("MissKitty81");
  });

  test("leaves an unknown id alone and survives a reference cycle", () => {
    const index = buildIdIndex([
      { "@graph": [{ "@type": "WebPage", "@id": "#page", isPartOf: { "@id": "#site" } }, { "@type": "WebSite", "@id": "#site", name: "Seite", mainEntity: { "@id": "#page" } }] },
    ]);
    const resolved = resolveNodeReferences({ "@type": "Recipe", isPartOf: { "@id": "#site" }, image: { "@id": "#nope" } }, index);
    expect((resolved.isPartOf as { name?: string }).name).toBe("Seite");
    expect(resolved.image).toEqual({ "@id": "#nope" });
  });

  test("a page without any @graph node comes back unchanged", () => {
    const node = { "@type": "Recipe", name: "X", image: { "@id": "https://a/#img" } };
    expect(resolveNodeReferences(node, new Map())).toBe(node);
  });
});

describe("schema.org value shapes", () => {
  test("scalar unwraps @value / name / url / arrays", () => {
    expect(scalar("Hallo")).toBe("Hallo");
    expect(scalar(42)).toBe("42");
    expect(scalar({ "@value": "x" })).toBe("x");
    expect(scalar({ name: "Oma" })).toBe("Oma");
    expect(scalar([{ name: "Oma" }, "zweit"])).toBe("Oma");
    expect(scalar(undefined)).toBeUndefined();
  });

  test("scalar refuses a bare @id, so a @graph pointer never becomes a name", () => {
    expect(scalar({ "@id": "https://www.chefkoch.de/#organization" })).toBeUndefined();
    expect(scalar({ "@type": "Person", "@id": "https://x/#author" })).toBeUndefined();
    // An @id NEXT TO real content is still readable.
    expect(scalar({ "@id": "https://x/#author", name: "Oma" })).toBe("Oma");
  });

  test("imageUrls handles string, array, ImageObject and @list", () => {
    expect(imageUrls("https://a/b.jpg")).toEqual(["https://a/b.jpg"]);
    expect(imageUrls(["https://a/1.jpg", "https://a/2.jpg"])).toEqual(["https://a/1.jpg", "https://a/2.jpg"]);
    expect(imageUrls({ url: "https://a/o.jpg" })).toEqual(["https://a/o.jpg"]);
    expect(imageUrls([{ contentUrl: "https://a/c.jpg" }])).toEqual(["https://a/c.jpg"]);
    expect(imageUrls({ "@list": [{ url: "//cdn/x.jpg" }] })).toEqual(["//cdn/x.jpg"]);
  });

  test("imageUrls skips a bare @id — it is a @graph pointer, not the photo", () => {
    // Unresolved, this @id would make the RECIPE PAGE the hero image.
    expect(imageUrls({ "@id": "https://www.chefkoch.de/rezepte/1/Pfannkuchen.html#primaryimage" })).toEqual([]);
    expect(imageUrls({ "@type": "ImageObject", "@id": "https://x/#primaryimage" })).toEqual([]);
    // Still read when the node carries an actual url beside its id.
    expect(imageUrls({ "@id": "https://x/#primaryimage", url: "https://cdn/x.jpg" })).toEqual(["https://cdn/x.jpg"]);
  });

  test("flattenInstructions: plain string is split on newlines", () => {
    const steps = flattenInstructions("Schritt eins.\nSchritt zwei.");
    expect(steps.map((step) => step.text)).toEqual(["Schritt eins.", "Schritt zwei."]);
  });

  test("flattenInstructions: array of strings", () => {
    expect(flattenInstructions(["A", "B"]).map((step) => step.text)).toEqual(["A", "B"]);
  });

  test("flattenInstructions: HowToStep array", () => {
    const steps = flattenInstructions([
      { "@type": "HowToStep", text: "Erst das" },
      { "@type": "HowToStep", text: "Dann das" },
    ]);
    expect(steps.map((step) => step.text)).toEqual(["Erst das", "Dann das"]);
  });

  test("flattenInstructions: HowToSection assigns the section name", () => {
    const steps = flattenInstructions([
      {
        "@type": "HowToSection",
        name: "Teig",
        itemListElement: [{ "@type": "HowToStep", text: "Mehl sieben" }],
      },
      {
        "@type": "HowToSection",
        name: "Backen",
        itemListElement: ["In den Ofen"],
      },
    ]);
    expect(steps).toEqual([
      { text: "Mehl sieben", section: "Teig" },
      { text: "In den Ofen", section: "Backen" },
    ]);
  });

  test("flattenInstructions: an HTML <ol> blob becomes one step per <li>", () => {
    const steps = flattenInstructions("<ol><li>Eins</li><li>Zwei</li></ol>");
    expect(steps.map((step) => step.text)).toEqual(["Eins", "Zwei"]);
  });

  test("mapSchemaRecipe parses ISO-8601 durations and derives the total", () => {
    const fields = mapSchemaRecipe({
      "@type": "Recipe",
      name: "T",
      prepTime: "PT1H15M",
      cookTime: "PT30M",
      recipeIngredient: ["1 Ei"],
    });
    expect(fields.prepMinutes).toBe(75);
    expect(fields.cookMinutes).toBe(30);
    expect(fields.totalMinutes).toBe(105);
  });

  test("mapSchemaRecipe strips tags and entities from every text field", () => {
    const fields = mapSchemaRecipe({
      "@type": "Recipe",
      name: "<b>Titel</b>&nbsp;mit Markup",
      description: "Ein <em>guter</em> Kuchen &amp; mehr",
      recipeIngredient: ["<strong>250&nbsp;g</strong> Mehl"],
      recipeInstructions: "<p>Alles <i>gut</i> ver&uuml;hren.</p>",
    });
    expect(fields.title).toBe("Titel mit Markup");
    expect(fields.description).toBe("Ein guter Kuchen & mehr");
    expect(fields.ingredients?.[0]?.name).toBe("Mehl");
    expect(fields.ingredients?.[0]?.quantity).toBe(250);
    expect(fields.steps?.[0]?.text).toBe("Alles gut verühren.");
  });
});

describe("microdata fallback", () => {
  test("extracts the Recipe item with the right properties", () => {
    const items = extractMicrodataItems(fixture("microdata-only.html"), "Recipe");
    expect(items).toHaveLength(1);
    const node = items[0]!;
    expect(node["@type"]).toBe("Recipe");
    expect(node.name).toBe("Apfelkuchen vom Blech");
    expect(node.prepTime).toBe("PT35M");
    expect(Array.isArray(node.recipeIngredient)).toBe(true);
  });

  test("a nested itemscope becomes a nested object, not a leaked property", () => {
    const node = findMicrodataRecipe(fixture("microdata-only.html"));
    expect(node).not.toBeNull();
    expect(typeof node?.author).toBe("object");
    expect((node?.author as Record<string, unknown>).name).toBe("Backstube Müller");
    // "calories" belongs to the nested NutritionInformation, not to the Recipe.
    expect(node?.calories).toBeUndefined();
    expect((node?.nutrition as Record<string, unknown>).calories).toBe("310 kcal");
  });

  test("a page without JSON-LD still yields a full recipe", () => {
    const result = extractRecipeFromHtml(fixture("microdata-only.html"), { url: MICRODATA_URL });
    expect(result.method).toBe("microdata");
    expect(result.parsed.title).toBe("Apfelkuchen vom Blech");
    expect(result.parsed.ingredients).toHaveLength(10);
    expect(result.parsed.steps).toHaveLength(5);
    expect(result.parsed.servings).toEqual({ amount: 20, unit: "Stück" });
  });
});

describe("adapter registry", () => {
  test("hostMatches covers subdomains but not look-alikes", () => {
    expect(hostMatches("www.chefkoch.de", "chefkoch.de")).toBe(true);
    expect(hostMatches("m.chefkoch.de", "chefkoch.de")).toBe(true);
    expect(hostMatches("chefkoch.de.evil.com", "chefkoch.de")).toBe(false);
  });

  test("adapterForHost resolves the registered adapters", () => {
    expect(adapterForHost("www.chefkoch.de")?.id).toBe("chefkoch");
    expect(adapterForHost("biancazapatka.com")?.id).toBe("wprm");
    expect(adapterForHost("unknown.example")).toBeUndefined();
  });

  test("the WPRM adapter also applies to an unknown host with WPRM markup", () => {
    const doc = parseHtml('<div class="wprm-recipe-container"></div>');
    const ids = adaptersFor("some-other-blog.example", doc).map((adapter) => adapter.id);
    expect(ids).toContain("wprm");
    expect(ids.at(-1)).toBe("generic");
  });
});

describe("chefkoch fixture", () => {
  const result = extractRecipeFromHtml(fixture("chefkoch-jsonld.html"), { url: CHEFKOCH_URL });

  test("uses JSON-LD as the primary source", () => {
    expect(result.method).toBe("json-ld");
    expect(result.host).toBe("chefkoch.de");
  });

  test("maps the core fields", () => {
    expect(result.parsed.title).toBe("Klassische Pfannkuchen");
    expect(result.parsed.sourceName).toBe("Chefkoch");
    expect(result.parsed.sourceUrl).toBe(CHEFKOCH_URL);
    expect(result.parsed.servings).toEqual({ amount: 4, unit: "Portionen" });
    expect(result.parsed.prepMinutes).toBe(20);
    expect(result.parsed.cookMinutes).toBe(45);
    expect(result.parsed.totalMinutes).toBe(65);
    expect(result.parsed.language).toBe("de");
  });

  test("the description keeps no markup and no entities", () => {
    expect(result.parsed.description).toBe(
      "Klassische Pfannkuchen – schnell und einfach. Ein Rezept für die ganze Familie.",
    );
  });

  test("ingredients are parsed with quantity + unit", () => {
    expect(result.parsed.ingredients).toHaveLength(8);
    expect(result.parsed.ingredients[0]).toMatchObject({ quantity: 250, unit: "g", name: "Mehl" });
    expect(result.parsed.ingredients[2]).toMatchObject({ quantity: 500, unit: "ml", name: "Milch" });
    expect(result.parsed.ingredients[3]).toMatchObject({ quantity: 1, unit: "Prise", name: "Salz" });
  });

  test("the ingredient GROUP headings only present in the HTML table are adopted", () => {
    const sections = result.parsed.ingredients.map((ingredient) => ingredient.section);
    expect(sections[0]).toBe("Für den Teig");
    expect(sections[5]).toBe("Zum Braten");
    expect(sections[6]).toBe("Für die Füllung");
  });

  test("instructions from a single newline-separated string become 4 steps", () => {
    expect(result.parsed.steps).toHaveLength(4);
    expect(result.parsed.steps[0]?.text).toStartWith("Mehl, Eier, Milch");
    expect(result.parsed.steps[3]?.text).toBe("Mit Puderzucker bestäuben und sofort servieren.");
  });

  test("difficulty comes from the chefkoch markup ('simpel' -> 'einfach')", () => {
    expect(result.parsed.difficulty).toBe("einfach");
  });

  test("keywords, category and cuisine become tags", () => {
    expect(result.parsed.tags).toContain("vegetarisch");
    expect(result.parsed.tags).toContain("Hauptgericht");
  });

  test("nutrition and the author land in the notes", () => {
    expect(result.parsed.notes).toContain("Kalorien: 420 kcal");
    expect(result.parsed.notes).toContain("Familienkoch77");
  });

  test("rawText keeps a readable rendering of the source", () => {
    expect(result.rawText).toContain("Zutaten:");
    expect(result.rawText).toContain("Zubereitung:");
    expect(result.rawText).toContain("250 g Mehl");
  });

  test("confidence is high for a structured page", () => {
    expect(result.parsed.confidence.overall).toBeGreaterThan(0.85);
  });
});

describe("chefkoch @graph fixture (properties given as @id references)", () => {
  const result = extractRecipeFromHtml(fixture("chefkoch-graph.html"), { url: CHEFKOCH_GRAPH_URL });

  test("the hero image is the referenced ImageObject, not the page url", () => {
    // The regression this fixture exists for: `image: {"@id": "…html#primaryimage"}`
    // used to yield the recipe PAGE, which the review pane rendered as a broken image.
    expect(result.parsed.imageUrl).toBe(
      "https://img.chefkoch-cdn.de/rezepte/2133611343071438/bilder/1383229/crop-960x540/rote-linsen-curry.jpg",
    );
    expect(result.parsed.imageUrl).not.toContain("#primaryimage");
  });

  test("og:image is kept as the fallback candidate, ranked behind the JSON-LD one", () => {
    expect(result.imageCandidates).toEqual([
      "https://img.chefkoch-cdn.de/rezepte/2133611343071438/bilder/1383229/crop-960x540/rote-linsen-curry.jpg",
      "https://img.chefkoch-cdn.de/rezepte/2133611343071438/bilder/1383229/og/rote-linsen-curry.jpg",
    ]);
  });

  test("the referenced publisher becomes the site name and the author a note", () => {
    expect(result.parsed.sourceName).toBe("Chefkoch");
    expect(result.parsed.notes).toContain("MissKitty81");
    expect(result.parsed.notes).not.toContain("#author");
  });

  test("the recipe itself still maps normally", () => {
    expect(result.method).toBe("json-ld");
    expect(result.parsed.title).toBe("Rote Linsen-Curry mit Spaghetti");
    expect(result.parsed.ingredients).toHaveLength(8);
    expect(result.parsed.steps).toHaveLength(4);
    expect(result.parsed.servings).toEqual({ amount: 4, unit: "Portionen" });
    expect(result.parsed.totalMinutes).toBe(30);
  });
});

describe("biancazapatka / WP Recipe Maker fixture", () => {
  const result = extractRecipeFromHtml(fixture("biancazapatka-wprm.html"), { url: WPRM_URL });

  test("maps title, description and image", () => {
    expect(result.parsed.title).toBe("Vegane Zimtschnecken");
    expect(result.parsed.description).toStartWith("Diese veganen Zimtschnecken sind fluffig");
    expect(result.parsed.imageUrl).toBe("https://biancazapatka.com/wp-content/uploads/2021/01/zimtschnecken.jpg");
  });

  test("recipeYield array prefers the entry with a real unit", () => {
    expect(result.parsed.servings).toEqual({ amount: 12, unit: "Stück" });
  });

  test("split hours/minutes markup adds up to the total time", () => {
    expect(result.parsed.prepMinutes).toBe(30);
    expect(result.parsed.cookMinutes).toBe(25);
    expect(result.parsed.totalMinutes).toBe(145);
  });

  test("all three WPRM ingredient groups become sections, aligned by position", () => {
    const sections = result.parsed.ingredients.map((ingredient) => ingredient.section);
    expect(sections.slice(0, 6)).toEqual(new Array(6).fill("Für den Hefeteig"));
    expect(sections.slice(6, 9)).toEqual(new Array(3).fill("Für die Zimtfüllung"));
    // A duplicate ingredient name ("Pflanzenmilch") must not pull the last entry
    // back into the first group.
    expect(sections.slice(9)).toEqual(["Für die Glasur", "Für die Glasur"]);
  });

  test("ranges keep their upper bound", () => {
    const last = result.parsed.ingredients.at(-1);
    expect(last).toMatchObject({ quantity: 2, quantityMax: 3, unit: "EL", name: "Pflanzenmilch" });
  });

  test("ingredient notes come from the WPRM notes span", () => {
    const milk = result.parsed.ingredients.find((ingredient) => ingredient.name === "Pflanzenmilch");
    expect(milk?.note).toBe("lauwarm");
  });

  test("all 7 instruction steps are present", () => {
    expect(result.parsed.steps).toHaveLength(7);
    expect(result.parsed.steps[5]?.text).toContain("180 °C");
  });

  test("sourceName is the real site name, not the plugin name", () => {
    expect(result.parsed.sourceName).toBe("Bianca Zapatka | Rezepte");
  });

  test("language is reduced to its primary subtag", () => {
    expect(result.parsed.language).toBe("de");
  });
});

describe("@graph + HowToSection fixture", () => {
  const result = extractRecipeFromHtml(fixture("graph-howtosection.html"), { url: GRAPH_URL });

  test("finds the Recipe inside @graph next to a BreadcrumbList", () => {
    expect(result.method).toBe("json-ld");
    expect(result.parsed.title).toBe("Lasagne Bolognese");
  });

  test("HowToSection names become step sections", () => {
    expect(result.parsed.steps).toHaveLength(6);
    expect(result.parsed.steps[0]?.section).toBe("Bolognese kochen");
    expect(result.parsed.steps[2]?.section).toBe("Béchamel zubereiten");
    expect(result.parsed.steps[4]?.section).toBe("Schichten und backen");
  });

  test('"Für die Bolognese:" entries in recipeIngredient become sections', () => {
    expect(result.parsed.ingredients).toHaveLength(12);
    expect(result.parsed.ingredients[0]?.section).toBe("Für die Bolognese");
    expect(result.parsed.ingredients[6]?.section).toBe("Für die Béchamelsauce");
    expect(result.parsed.ingredients[10]?.section).toBe("Außerdem");
  });

  test("a numeric recipeYield is accepted", () => {
    expect(result.parsed.servings).toEqual({ amount: 6, unit: "Portionen" });
  });

  test("a protocol-relative image URL is absolutised", () => {
    expect(result.parsed.imageUrl).toBe("https://cdn.kochblog.example/lasagne.jpg");
  });

  test("trailing-comma + CDATA JSON-LD still parses", () => {
    expect(result.layers).toContain("json-ld");
  });
});

describe("HowToStep array fixture", () => {
  const result = extractRecipeFromHtml(fixture("howtostep-array.html"), { url: HOWTO_URL });

  test("maps every HowToStep", () => {
    expect(result.parsed.steps).toHaveLength(4);
    expect(result.parsed.steps[0]?.text).toStartWith("Kartoffeln, Karotten");
  });

  test("a servings range keeps its upper bound", () => {
    expect(result.parsed.servings).toEqual({ amount: 6, unit: "Portionen" });
  });

  test("a keywords ARRAY becomes tags", () => {
    expect(result.parsed.tags).toEqual(expect.arrayContaining(["Kartoffeln", "Suppe", "Hausmannskost"]));
  });

  test("a plain-string author lands in the notes, not in sourceName", () => {
    expect(result.parsed.sourceName).toBe("Omas Küche");
    expect(result.parsed.notes).toContain("Oma Erna");
  });
});

describe("resilience", () => {
  test("a page with no recipe data yields empty ingredients and steps", () => {
    const result = extractRecipeFromHtml("<html><body><h1>Impressum</h1><p>Nichts hier.</p></body></html>", {
      url: "https://example.com/impressum",
    });
    expect(result.parsed.ingredients).toHaveLength(0);
    expect(result.parsed.steps).toHaveLength(0);
    expect(result.parsed.confidence.overall).toBeLessThan(0.5);
  });

  test("truncated markup does not throw", () => {
    const html = '<html><body><div class="wprm-recipe-container"><ul><li class="wprm-recipe-ingredient">250 g Mehl';
    expect(() => extractRecipeFromHtml(html, { url: "https://example.com/x" })).not.toThrow();
  });

  test("the parser survives an unclosed <script> block", () => {
    const doc = parseHtml('<html><head><script type="application/ld+json">{"a":1}');
    expect(queryAll(doc, "script")).toHaveLength(1);
    expect(textOf(queryAll(doc, "script")[0]?.children[0])).toBe('{"a":1}');
  });
});

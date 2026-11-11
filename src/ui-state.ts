/** `Settings/ui-common.xml`: how the project's window was last shown, on every platform. */
import {
  attribute,
  element,
  integer,
  list,
  optionalChild,
  optionalList,
  optionalTextChild,
  repeated,
  string,
  text,
  textChild,
  textElement,
  yesNo,
} from './xml-codec.ts';

const itemId = textElement('ItemID', string);
const yes = (name: string) => textChild(name, yesNo);
const word = (name: string) => textChild(name, string);
const on = text(yesNo);

/** Text settings an editor, its copyholder and full screen share. */
const pageLayout = element('PageLayout', { facing: attribute('Facing', yesNo), on });
const lineNumbers = element('LineNumbers', { interval: attribute('Interval', integer), on });

function child<T>(codec: Parameters<typeof optionalChild<T>>[0]) {
  return optionalChild(codec);
}

const copyholderText = element('Text', {
  showRuler: yes('ShowRuler'),
  pageLayout: child(pageLayout),
  typewriterScrolling: yes('TypewriterScrolling'),
  lineNumbers: child(lineNumbers),
});

const editorText = element('Text', {
  showRuler: yes('ShowRuler'),
  pageLayout: child(pageLayout),
  typewriterScrolling: yes('TypewriterScrolling'),
  lineNumbers: child(lineNumbers),
  selection: word('Selection'),
});

const historyItem = element('HistoryItem', {
  type: attribute('Type', string),
  viewMode: attribute('ViewMode', string),
  item: text(string),
});

const view = element('View', {
  showHeader: yes('ShowHeader'),
  showFooter: yes('ShowFooter'),
  groupsViewMode: word('GroupsViewMode'),
  currentViewMode: optionalTextChild('CurrentViewMode', string),
  selectionAffects: word('SelectionAffects'),
  content: optionalList('Content', itemId),
  navigationHistory: child(
    element('NavigationHistory', {
      currentIndex: attribute('CurrentIndex', integer),
      items: repeated(historyItem),
    }),
  ),
});

const outliner = element('Outliner', {
  columns: list('Columns', textElement('ColID', string)),
  titlesOnly: yes('TitlesOnly'),
  hideIcons: yes('HideIcons'),
  showNumbers: yes('ShowNumbers'),
  keywordsAsChips: yes('KeywordsAsChips'),
  fixedRowHeights: yes('FixedRowHeights'),
});

const corkboard = element('Corkboard', {
  cardsAcross: textChild('CardsAcross', integer),
  keywordChips: textChild('KeywordChips', integer),
  sizeCardsToFit: yes('SizeCardsToFit'),
  cardHeightRatio: word('CardHeightRatio'),
  sectionsArrangement: word('SectionsArrangement'),
  labelThreadsUseColumns: yes('LabelThreadsUseColumns'),
});

/** A copyholder's items: Scrivener writes this list's element open when it has none. */
const copyholderContent = element('Content', { items: repeated(itemId) });
const openWhenEmpty = {
  ...copyholderContent,
  write: (value: { items: string[] }) => ({ content: [], ...copyholderContent.write(value) }),
};

const copyholder = element('Copyholder', {
  preferredOrientation: attribute('PreferredOrientation', string),
  verticalPos: attribute('VerticalPos', string),
  horizontalPos: attribute('HorizontalPos', string),
  content: child(openWhenEmpty),
  text: child(copyholderText),
});

const editor = (name: string) =>
  element(name, {
    view: child(view),
    text: child(editorText),
    outliner: child(outliner),
    corkboard: child(corkboard),
    copyholder: child(copyholder),
  });

const binder = element('Binder', {
  show: attribute('Show', yesNo),
  showCollections: yes('ShowCollections'),
  selectedCollection: textChild('SelectedCollection', integer),
  subdocumentCounts: yes('SubdocumentCounts'),
  expandedItems: optionalList('ExpandedItems', itemId),
  selection: optionalList('Selection', itemId),
  searchResultsSort: child(
    element('SearchResultsSort', {
      titles: attribute('Titles', string),
      dates: attribute('Dates', string),
      sort: text(string),
    }),
  ),
});

const inspector = element('Inspector', {
  show: attribute('Show', yesNo),
  view: attribute('View', string),
  showProjectBookmarks: yes('ShowProjectBookmarks'),
  showSimilarTexts: yes('ShowSimilarTexts'),
  collapse: repeated(textElement('Collapse', string)),
  footnoteNumbers: child(element('FootnoteNumbers', { prompt: attribute('Prompt', yesNo), on })),
});

const labels = element('Labels', {
  binder: child(element('Binder', { fullWidth: attribute('FullWidth', yesNo), on })),
  icons: yes('Icons'),
  indexCards: yes('IndexCards'),
  outlinerRows: yes('OutlinerRows'),
  scriveningsTitles: yes('ScriveningsTitles'),
});

const corkboards = element('Corkboards', {
  labelIndicators: yes('LabelIndicators'),
  stamps: yes('Stamps'),
  keywords: yes('Keywords'),
  numbers: child(element('Numbers', { restart: attribute('Restart', yesNo), on })),
  snapToGrid: yes('SnapToGrid'),
  blankCardsAsGhosts: yes('BlankCardsAsGhosts'),
});

const textSettings = element('Text', {
  showFormatBar: yes('ShowFormatBar'),
  useVerticalLayout: yes('UseVerticalLayout'),
  showScriveningsTitles: yes('ShowScriveningsTitles'),
  showInvisibles: yes('ShowInvisibles'),
  revisionMode: textChild('RevisionMode', integer),
  textChecking: child(
    element('TextChecking', {
      spelling: yes('Spelling'),
      grammar: yes('Grammar'),
      smartQuotes: yes('SmartQuotes'),
      smartDashes: yes('SmartDashes'),
    }),
  ),
});

const fullScreen = element('FullScreen', {
  showRuler: yes('ShowRuler'),
  pageLayout: child(pageLayout),
  typewriterScrolling: yes('TypewriterScrolling'),
});

const editors = element('Editors', {
  primary: attribute('Primary', string),
  editor1: child(editor('Editor1')),
  editor2: child(editor('Editor2')),
});

/** The `Settings/ui-common.xml` file. */
export const uiStateFile = element('UIStates', {
  binder: child(binder),
  inspector: child(inspector),
  split: word('Split'),
  binderAffects: word('BinderAffects'),
  labels: child(labels),
  corkboards: child(corkboards),
  text: child(textSettings),
  projectKeywords: child(
    element('ProjectKeywords', { expandedItems: optionalList('ExpandedItems', itemId) }),
  ),
  fullScreen: child(fullScreen),
  editors: child(editors),
});

/**
 * A blank project as Scrivener wrote it, which it needs to open one: `createProject` reads these
 * files with their codecs and gives each what must be its own.  They are
 * `test/fixtures/blank.scriv`, as a test holds them to; a browser has no fixture to read.
 */

/** The project file. */
export const PROJECT_FILE = `<?xml version="1.0" encoding="UTF-8"?>
<ScrivenerProject Identifier="FCB68A0F-3984-4310-BC5E-43D4052FAE13" Version="2.0" Creator="SCRMAC-3.5.2-17487" Device="MacBook-Pro-2" Author="" Modified="2026-10-31 01:13:08 -0400" ModID="406A0A85-F723-4FB6-A249-9575FA55C845">
    <Binder>
        <BinderItem UUID="54BD443B-FDCA-4C73-9679-A884A57E09E6" Type="DraftFolder" Created="2026-10-31 01:13:04 -0400" Modified="2026-10-31 01:13:04 -0400">
            <Title>Draft</Title>
            <MetaData>
                <IncludeInCompile>Yes</IncludeInCompile>
            </MetaData>
            <Children>
                <BinderItem UUID="654C18BF-0890-4276-8043-EC26A8EC23CF" Type="Text" Created="2026-10-31 01:13:04 -0400" Modified="2026-10-31 01:13:04 -0400">
                    <MetaData>
                        <IncludeInCompile>Yes</IncludeInCompile>
                    </MetaData>
                    <TextSettings>
                        <TextSelection>0,0</TextSelection>
                    </TextSettings>
                </BinderItem>
            </Children>
        </BinderItem>
        <BinderItem UUID="F7F83D60-67F9-4376-8809-BDA40812DE26" Type="ResearchFolder" Created="2026-10-31 01:13:04 -0400" Modified="2026-10-31 01:13:04 -0400">
            <Title>Research</Title>
            <MetaData>
                <IncludeInCompile>Yes</IncludeInCompile>
            </MetaData>
        </BinderItem>
        <BinderItem UUID="4F10738F-C495-497B-A9CA-54E763702CE1" Type="TrashFolder" Created="2026-10-31 01:13:04 -0400" Modified="2026-10-31 01:13:04 -0400">
            <Title>Trash</Title>
            <MetaData>
                <IncludeInCompile>Yes</IncludeInCompile>
            </MetaData>
        </BinderItem>
    </Binder>
    <Collections>
        <Collection Type="Binder" ID="5DA9FF7E-F81A-4813-83F4-5AE8A46533B1" Color="0.112547 0.112547 0.112547">
            <Title>Binder</Title>
        </Collection>
        <Collection Type="RecentSearch" ID="E933D95D-EE24-4548-8C22-46372BCB0B42" Color="0.190666 0.172707 0.216531">
            <Title>Search Results</Title>
        </Collection>
    </Collections>
    <SectionTypes>
        <TypeDefinitions>
            <Type ID="C6B39E90-02BC-4B4B-AFC7-77CE685FD644">Heading</Type>
            <Type ID="0AC65ACC-AF13-41C3-B22D-161220936660">Sub-Heading</Type>
            <Type ID="812CD63D-A184-4DBE-8E52-B9F11991C4BF">Section</Type>
        </TypeDefinitions>
        <LevelTypes>
            <Folders>
                <Type>C6B39E90-02BC-4B4B-AFC7-77CE685FD644</Type>
            </Folders>
            <Containers>
                <Type>812CD63D-A184-4DBE-8E52-B9F11991C4BF</Type>
            </Containers>
            <Files>
                <Type>812CD63D-A184-4DBE-8E52-B9F11991C4BF</Type>
            </Files>
        </LevelTypes>
    </SectionTypes>
    <LabelSettings>
        <Title>Label</Title>
        <DefaultLabelID>-1</DefaultLabelID>
        <Labels>
            <Label ID="-1">No Label</Label>
            <Label ID="0" Color="0.993495 0.701227 0.732594">Red</Label>
            <Label ID="1" Color="0.995418 0.790968 0.65239">Orange</Label>
            <Label ID="2" Color="0.99772 0.892753 0.652574">Yellow</Label>
            <Label ID="3" Color="0.715848 0.948734 0.697698">Green</Label>
            <Label ID="4" Color="0.702312 0.888297 0.97426">Blue</Label>
            <Label ID="5" Color="0.957564 0.766768 0.999625">Purple</Label>
        </Labels>
    </LabelSettings>
    <StatusSettings>
        <Title>Status</Title>
        <DefaultStatusID>-1</DefaultStatusID>
        <StatusItems>
            <Status ID="-1">No Status</Status>
            <Status ID="0">To Do</Status>
            <Status ID="1">In Progress</Status>
            <Status ID="2">First Draft</Status>
            <Status ID="3">Revised Draft</Status>
            <Status ID="4">Final Draft</Status>
            <Status ID="5">Done</Status>
        </StatusItems>
    </StatusSettings>
    <ProjectTargets Notify="No">
        <DraftTarget Type="Words" CountIncludedOnly="Yes" CurrentCompileGroupOnly="No" Deadline="2026-10-31 01:13:02 -0400" IgnoreDeadline="Yes">0</DraftTarget>
        <SessionTarget Type="Words" CountDraftOnly="Yes" AllowNegatives="Yes" NextResetDate="2026-11-01 01:00:00 -0400" ResetType="Time" ResetTime="00:00" DeterminedFromDeadline="No" WritingDays="" CanWriteOnDeadlineDate="No">0</SessionTarget>
        <PreviousSession Words="0" Characters="0" Date="2026-10-31 01:13:02 -0400"/>
    </ProjectTargets>
    <RecentWritingHistory Date="2026-10-31 01:13:02 -0400">
        <DraftWordCount>0</DraftWordCount>
        <DraftCharCount>0</DraftCharCount>
        <OtherWordCount>0</OtherWordCount>
        <OtherCharCount>0</OtherCharCount>
    </RecentWritingHistory>
    <PrintSettings PaperSize="612.0,792.0" LeftMargin="72.0" RightMargin="72.0" TopMargin="90.0" BottomMargin="90.0" PaperType="na-letter" Orientation="Portrait" HorizontalPagination="Clip" VerticalPagination="Auto" ScaleFactor="1.0" HorizontallyCentered="Yes" VerticallyCentered="Yes" Collates="Yes" PagesAcross="1" PagesDown="1"/>
</ScrivenerProject>`;

/** `Settings/compile.xml`. */
export const COMPILE_SETTINGS = `<?xml version="1.0" encoding="UTF-8"?>
<CompileSettings>
    <ProjectSettings>
        <Content Scope="Included">
            <Filter State="Off" Exclude="No" Type="Label">
                <Label>-1</Label>
                <Status>-1</Status>
            </Filter>
        </Content>
        <Options>
            <RemoveComments>Yes</RemoveComments>
            <RemoveAnnotations>Yes</RemoveAnnotations>
            <ResampleImages DPI="72">No</ResampleImages>
            <ConvertTablesAndListToMMD>Yes</ConvertTablesAndListToMMD>
            <PDF>
                <Cover Bleed="9.0" BleedUnits="pt"/>
                <Compression Enabled="No">
                    <ImageResolutionCompressionType>Set</ImageResolutionCompressionType>
                    <ImageResolution>150</ImageResolution>
                    <CompressionQuality>0.5</CompressionQuality>
                </Compression>
            </PDF>
            <Scriptwriting>
                <IncludeTitles>Yes</IncludeTitles>
                <IncludeSynopses>Yes</IncludeSynopses>
                <CommentsAsScriptNotes>Yes</CommentsAsScriptNotes>
            </Scriptwriting>
            <Ebook>
                <StartAfterFrontMatter>Yes</StartAfterFrontMatter>
                <Cover>
                    <ImageDocument Source="FrontMatter"/>
                    <Title>Cover</Title>
                    <SVG Width="600" Height="800"><![CDATA[]]></SVG>
                </Cover>
                <TOC PandocDepth="3">
                    <HTML Generate="Yes">
                        <Title>Contents</Title>
                    </HTML>
                </TOC>
            </Ebook>
        </Options>
        <MetaData>
            <ProjectTitle>blank-scriv-doc</ProjectTitle>
            <ProjectAbbreviatedTitle>blank-scriv-doc</ProjectAbbreviatedTitle>
            <Authors>
                <Author Role="aut"></Author>
            </Authors>
            <EbookLanguage>en</EbookLanguage>
            <FountainTitlePageMetaData>
                <Value Key="Title"><![CDATA[<$projecttitle>]]></Value>
                <Value Key="Author"><![CDATA[<$author>]]></Value>
            </FountainTitlePageMetaData>
            <MMDMetaData>
                <Value Key="Title"><![CDATA[<$projecttitle>]]></Value>
                <Value Key="Author"><![CDATA[<$author>]]></Value>
            </MMDMetaData>
        </MetaData>
    </ProjectSettings>
    <CurrentFileType>Print</CurrentFileType>
    <FormatSettings>
        <Format ID="DEFAULT">
            <SectionLayouts>
                <Type ID="C6B39E90-02BC-4B4B-AFC7-77CE685FD644">NEW-PAGE-HEADER-WITH-TEXT</Type>
                <Type ID="812CD63D-A184-4DBE-8E52-B9F11991C4BF">TEXT-SECTION</Type>
            </SectionLayouts>
        </Format>
    </FormatSettings>
    <LastUsedFormats/>
</CompileSettings>`;

/** What each of the two editors keeps below its view, as `Settings/ui-common.xml` writes it. */
const EDITOR_SETTINGS = `            <Text>
                <ShowRuler>No</ShowRuler>
                <PageLayout Facing="No">No</PageLayout>
                <TypewriterScrolling>No</TypewriterScrolling>
                <LineNumbers Interval="1">No</LineNumbers>
                <Selection>0,0</Selection>
            </Text>
            <Outliner>
                <Columns>
                    <ColID>title</ColID>
                    <ColID>label</ColID>
                    <ColID>status</ColID>
                    <ColID>sectionType</ColID>
                </Columns>
                <TitlesOnly>No</TitlesOnly>
                <HideIcons>No</HideIcons>
                <ShowNumbers>No</ShowNumbers>
                <KeywordsAsChips>Yes</KeywordsAsChips>
                <FixedRowHeights>No</FixedRowHeights>
            </Outliner>
            <Corkboard>
                <CardsAcross>-1</CardsAcross>
                <KeywordChips>5</KeywordChips>
                <SizeCardsToFit>Yes</SizeCardsToFit>
                <CardHeightRatio>0.6666</CardHeightRatio>
                <SectionsArrangement>Wrap</SectionsArrangement>
                <LabelThreadsUseColumns>No</LabelThreadsUseColumns>
            </Corkboard>
            <Copyholder PreferredOrientation="Vertical" VerticalPos="Right" HorizontalPos="Bottom">
                <Text>
                    <ShowRuler>No</ShowRuler>
                    <PageLayout Facing="No">No</PageLayout>
                    <TypewriterScrolling>No</TypewriterScrolling>
                    <LineNumbers Interval="1">No</LineNumbers>
                </Text>
            </Copyholder>
`;

/** `Settings/ui-common.xml`. */
export const WINDOW_STATE = `<?xml version="1.0" encoding="UTF-8"?>
<UIStates>
    <Binder Show="Yes">
        <ShowCollections>No</ShowCollections>
        <SelectedCollection>0</SelectedCollection>
        <SubdocumentCounts>No</SubdocumentCounts>
        <ExpandedItems>
            <ItemID>54BD443B-FDCA-4C73-9679-A884A57E09E6</ItemID>
        </ExpandedItems>
        <SearchResultsSort Titles="Ascending" Dates="Ascending">None</SearchResultsSort>
    </Binder>
    <Inspector Show="No" View="Notes">
        <ShowProjectBookmarks>No</ShowProjectBookmarks>
        <ShowSimilarTexts>No</ShowSimilarTexts>
        <Collapse>CustomMetaData</Collapse>
        <FootnoteNumbers Prompt="No">No</FootnoteNumbers>
    </Inspector>
    <Split>None</Split>
    <BinderAffects>Current</BinderAffects>
    <Labels>
        <Binder FullWidth="No">No</Binder>
        <Icons>No</Icons>
        <IndexCards>No</IndexCards>
        <OutlinerRows>No</OutlinerRows>
        <ScriveningsTitles>No</ScriveningsTitles>
    </Labels>
    <Corkboards>
        <LabelIndicators>Yes</LabelIndicators>
        <Stamps>No</Stamps>
        <Keywords>No</Keywords>
        <Numbers Restart="No">No</Numbers>
        <SnapToGrid>No</SnapToGrid>
        <BlankCardsAsGhosts>No</BlankCardsAsGhosts>
    </Corkboards>
    <Text>
        <ShowFormatBar>Yes</ShowFormatBar>
        <UseVerticalLayout>No</UseVerticalLayout>
        <ShowScriveningsTitles>No</ShowScriveningsTitles>
        <ShowInvisibles>No</ShowInvisibles>
        <RevisionMode>0</RevisionMode>
        <TextChecking>
            <Spelling>Yes</Spelling>
            <Grammar>No</Grammar>
            <SmartQuotes>Yes</SmartQuotes>
            <SmartDashes>Yes</SmartDashes>
        </TextChecking>
    </Text>
    <FullScreen>
        <ShowRuler>No</ShowRuler>
        <PageLayout Facing="No">No</PageLayout>
        <TypewriterScrolling>Yes</TypewriterScrolling>
    </FullScreen>
    <Editors Primary="Editor1">
        <Editor1>
            <View>
                <ShowHeader>Yes</ShowHeader>
                <ShowFooter>Yes</ShowFooter>
                <GroupsViewMode>Corkboard</GroupsViewMode>
                <CurrentViewMode>Single</CurrentViewMode>
                <SelectionAffects>None</SelectionAffects>
                <Content>
                    <ItemID>654C18BF-0890-4276-8043-EC26A8EC23CF</ItemID>
                </Content>
                <NavigationHistory CurrentIndex="0">
                    <HistoryItem Type="BinderItems" ViewMode="Single">654C18BF-0890-4276-8043-EC26A8EC23CF</HistoryItem>
                </NavigationHistory>
            </View>
${EDITOR_SETTINGS}        </Editor1>
        <Editor2>
            <View>
                <ShowHeader>Yes</ShowHeader>
                <ShowFooter>Yes</ShowFooter>
                <GroupsViewMode>Corkboard</GroupsViewMode>
                <SelectionAffects>None</SelectionAffects>
            </View>
${EDITOR_SETTINGS}        </Editor2>
    </Editors>
</UIStates>`;

/** `Settings/ui.plist`. */
export const MAC_WINDOW_STATE = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>NotesScaleFactor</key>
	<real>1</real>
	<key>binderSplitFrames</key>
	<array>
		<string>{{0, 0}, {265, 650}}</string>
		<string>{{266, 0}, {734, 650}}</string>
	</array>
	<key>bookmarksSelectionInfo</key>
	<dict>
		<key>654C18BF-0890-4276-8043-EC26A8EC23CF</key>
		<dict>
			<key>Row</key>
			<integer>-1</integer>
		</dict>
	</dict>
	<key>collectionsRepresentedBinderDocumentsInfo</key>
	<dict>
		<key>MainID</key>
		<string></string>
		<key>SupportingID</key>
		<string></string>
	</dict>
	<key>fullScreenTextEditorSettings</key>
	<dict>
		<key>textScaleFactor</key>
		<real>1.25</real>
	</dict>
	<key>inspectorSplitFrames</key>
	<array>
		<string>{{0, 0}, {512, 640}}</string>
	</array>
	<key>inspectorWidth</key>
	<real>248</real>
	<key>mainDocumentEditor.dockedQRTextSettings</key>
	<dict>
		<key>textScaleFactor</key>
		<real>1</real>
	</dict>
	<key>mainDocumentEditor.scrollRect</key>
	<string>{{-50, 0}, {719, 560}}</string>
	<key>mainDocumentEditor.textEditorState</key>
	<dict>
		<key>textScaleFactor</key>
		<real>1</real>
	</dict>
	<key>mainWindowFrame</key>
	<string>1252 420 1000 678 0 0 2560 1415 </string>
	<key>supportingDocumentEditor.dockedQRTextSettings</key>
	<dict>
		<key>textScaleFactor</key>
		<real>1</real>
	</dict>
	<key>supportingDocumentEditor.scrollRect</key>
	<string>{{0, 0}, {606, 290}}</string>
	<key>supportingDocumentEditor.textEditorState</key>
	<dict>
		<key>textScaleFactor</key>
		<real>1</real>
	</dict>
	<key>supportingDocumentViewIsCurrent</key>
	<false/>
</dict>
</plist>
`;

/** `Files/version.txt`: the file format's version. */
export const FORMAT_VERSION = 23;

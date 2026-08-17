// NOTE ON WHY THIS FILE ROUTES.
// The host allows twelve serverless functions per deployment and the thirteenth failed the
// whole build silently: the site kept serving the previous deployment, so the page was up,
// the new endpoint was a 404, and nothing anywhere said why. The comparable-sales engine
// therefore lives in lib/comps.js, which is bundled into this function rather than
// deployed as one of its own, and is reached at /api/parcel?mode=comps.
import compsHandler from "../lib/comps.js";

// /api/parcel — one address in, the deepest public record North Carolina will give up.
//
// Three tiers, tried in order and merged, deepest winning:
//
//   1. The county's own system, where it publishes one. Wake and Mecklenburg run their own
//      GIS; eleven more counties sit on the shared NCPTS tax platform. These carry the
//      things that actually change an answer: heated area separately from footprint, the
//      grade and condition the assessor assigned, the ownership chain with prices, and the
//      tax bill history including whether it is paid.
//   2. NC OneMap's statewide parcel layer, which reaches all 100 counties but only carries
//      what each county chose to publish into it.
//   3. Nothing, said plainly, rather than a guess.
//
// The excise stamp is the quiet prize. N.C. Gen. Stat. 105-228.30 sets the tax at one
// dollar per five hundred of consideration, so a recorded stamp of 212 is a sale at
// $106,000 — not an estimate, the consideration the parties swore to. Where a county
// publishes the stamp, this returns both the stated price and the price the stamp implies,
// and they should agree.
//
// Owner names are deliberately NOT returned by any tier, the same rule /api/deed follows.
// Nothing a visitor types is stored.

const cache = new Map();
const TTL = 1000 * 60 * 60 * 12;

const UA = { "User-Agent": "kpfeffer.com education proxy; contact mail@kpfeffer.com" };

// Counties on the shared NCPTS platform, confirmed answering with data.
const NCPTS = ["beaufort", "burke", "forsyth", "guilford", "henderson", "hertford",
               "hyde", "madison", "pitt", "rutherford", "stokes"];

// Municipality to county, from the U.S. Census Bureau 2020 place code file for North
// Carolina. This is here because the statewide parcel layer cannot be trusted to answer
// "which county is this address in": nine counties publish no site address into it at all,
// and a street name matched without a city lands wherever that name occurs first. Asking
// for 2000 Spring Garden Street in Greensboro used to return a parcel in Craven County.
// Places that straddle a line carry every county they touch, and each is tried in turn.
const PLACES = {"ABERDEEN":["Moore"],"ADVANCE":["Davie"],"AHOSKIE":["Hertford"],"ALAMANCE":["Alamance"],"ALBEMARLE":["Stanly"],"ALEXIS":["Gaston"],"ALLIANCE":["Pamlico"],"ALTAMAHAW":["Alamance"],"ANDERSON CREEK":["Harnett"],"ANDREWS":["Cherokee"],"ANGIER":["Harnett","Wake"],"ANSONVILLE":["Anson"],"APEX":["Wake"],"AQUADALE":["Stanly"],"ARAPAHOE":["Pamlico"],"ARCHDALE":["Guilford","Randolph"],"ARCHER LODGE":["Johnston"],"ARROWHEAD BEACH":["Chowan"],"ASHEBORO":["Randolph"],"ASHEVILLE":["Buncombe"],"ASHLEY HEIGHTS":["Hoke"],"ASKEWVILLE":["Bertie"],"ATKINSON":["Pender"],"ATLANTIC":["Carteret"],"ATLANTIC BEACH":["Carteret"],"AULANDER":["Bertie"],"AURORA":["Beaufort"],"AUTRYVILLE":["Sampson"],"AVERY CREEK":["Buncombe"],"AVON":["Dare"],"AYDEN":["Pitt"],"BADIN":["Stanly"],"BAILEY":["Nash"],"BAKERSVILLE":["Mitchell"],"BALD HEAD ISLAND":["Brunswick"],"BALFOUR":["Henderson"],"BANNER ELK":["Avery"],"BARKER HEIGHTS":["Henderson"],"BARKER TEN MILE":["Robeson"],"BARNARDSVILLE":["Buncombe"],"BATH":["Beaufort"],"BAYBORO":["Pamlico"],"BAYSHORE":["New Hanover"],"BAYVIEW":["Beaufort"],"BEAR GRASS":["Martin"],"BEAUFORT":["Carteret"],"BEECH MOUNTAIN":["Avery","Watauga"],"BELHAVEN":["Beaufort"],"BELL ARTHUR":["Pitt"],"BELMONT":["Gaston"],"BELVILLE":["Brunswick"],"BELVOIR":["Pitt"],"BELWOOD":["Cleveland"],"BENNETT":["Chatham"],"BENSON":["Harnett","Johnston"],"BENT CREEK":["Buncombe"],"BERMUDA RUN":["Davie"],"BESSEMER CITY":["Gaston"],"BETHANIA":["Forsyth"],"BETHEL":["Pitt"],"BETHLEHEM":["Alexander"],"BEULAVILLE":["Duplin"],"BILTMORE FOREST":["Buncombe"],"BISCOE":["Montgomery"],"BLACK CREEK":["Wilson"],"BLACK MOUNTAIN":["Buncombe"],"BLADENBORO":["Bladen"],"BLOWING ROCK":["Caldwell","Watauga"],"BLUE CLAY FARMS":["New Hanover"],"BOARDMAN":["Columbus"],"BOGUE":["Carteret"],"BOILING SPRING LAKES":["Brunswick"],"BOILING SPRINGS":["Cleveland"],"BOLIVIA":["Brunswick"],"BOLTON":["Columbus"],"BONNETSVILLE":["Sampson"],"BOONE":["Watauga"],"BOONVILLE":["Yadkin"],"BOSTIC":["Rutherford"],"BOWDENS":["Duplin"],"BOWMORE":["Hoke"],"BRANDYWINE BAY":["Carteret"],"BREVARD":["Transylvania"],"BRIAR CHAPEL":["Chatham"],"BRICES CREEK":["Craven"],"BRIDGETON":["Craven"],"BROAD CREEK":["Carteret"],"BROADWAY":["Harnett","Lee"],"BROGDEN":["Wayne"],"BROOKFORD":["Catawba"],"BRUNSWICK":["Columbus"],"BRYSON CITY":["Swain"],"BUIES CREEK":["Harnett"],"BUNN":["Franklin"],"BUNNLEVEL":["Harnett"],"BURGAW":["Pender"],"BURLINGTON":["Alamance","Guilford"],"BURNSVILLE":["Yancey"],"BUTNER":["Granville"],"BUTTERS":["Bladen"],"BUXTON":["Dare"],"CAJAH'S MOUNTAIN":["Caldwell"],"CALABASH":["Brunswick"],"CALYPSO":["Duplin"],"CAMDEN":["Camden"],"CAMERON":["Moore"],"CANDOR":["Montgomery","Moore"],"CANTON":["Haywood"],"CAPE CARTERET":["Carteret"],"CAPE COLONY":["Chowan"],"CAROLEEN":["Rutherford"],"CAROLINA BEACH":["New Hanover"],"CAROLINA MEADOWS":["Chatham"],"CAROLINA SHORES":["Brunswick"],"CARRBORO":["Orange"],"CARTHAGE":["Moore"],"CARY":["Chatham","Wake"],"CASAR":["Cleveland"],"CASHIERS":["Jackson"],"CASTALIA":["Nash"],"CASTLE HAYNE":["New Hanover"],"CASWELL BEACH":["Brunswick"],"CATAWBA":["Catawba"],"CEDAR POINT":["Carteret"],"CEDAR ROCK":["Caldwell"],"CENTERVILLE":["Franklin"],"CERRO GORDO":["Columbus"],"CHADBOURN":["Columbus"],"CHAPEL HILL":["Durham","Orange"],"CHARLOTTE":["Mecklenburg"],"CHEROKEE":["Jackson","Swain"],"CHERRY BRANCH":["Craven"],"CHERRYVILLE":["Gaston"],"CHIMNEY ROCK VILLAGE":["Rutherford"],"CHINA GROVE":["Rowan"],"CHINQUAPIN":["Duplin"],"CHOCOWINITY":["Beaufort"],"CHOWAN BEACH":["Chowan"],"CLAREMONT":["Catawba"],"CLARKTON":["Bladen"],"CLAYTON":["Johnston","Wake"],"CLEMMONS":["Forsyth"],"CLEVELAND":["Rowan"],"CLIFFSIDE":["Rutherford"],"CLINTON":["Sampson"],"CLYDE":["Haywood"],"COATS":["Harnett"],"COFIELD":["Hertford"],"COINJOCK":["Currituck"],"COLERAIN":["Bertie"],"COLUMBIA":["Tyrrell"],"COLUMBUS":["Polk"],"COMO":["Hertford"],"CONCORD":["Cabarrus"],"CONETOE":["Edgecombe"],"CONNELLY SPRINGS":["Burke"],"CONOVER":["Catawba"],"CONWAY":["Northampton"],"COOLEEMEE":["Davie"],"CORDOVA":["Richmond"],"CORNELIUS":["Mecklenburg"],"COVE CITY":["Craven"],"COVE CREEK":["Watauga"],"CRAMERTON":["Gaston"],"CREEDMOOR":["Granville"],"CRESWELL":["Washington"],"CRICKET":["Wilkes"],"CROSSNORE":["Avery"],"CROUSE":["Lincoln"],"CULLOWHEE":["Jackson"],"CYPRESS LANDING":["Beaufort"],"DALLAS":["Gaston"],"DANA":["Henderson"],"DANBURY":["Stokes"],"DAVIDSON":["Iredell","Mecklenburg"],"DAVIS":["Carteret"],"DEEP RUN":["Lenoir"],"DEERCROFT":["Scotland"],"DELCO":["Columbus"],"DELLVIEW":["Gaston"],"DELWAY":["Sampson"],"DENTON":["Davidson"],"DENVER":["Lincoln"],"DILLSBORO":["Jackson"],"DOBBINS HEIGHTS":["Richmond"],"DOBSON":["Surry"],"DORTCHES":["Nash"],"DOVER":["Craven"],"DREXEL":["Burke"],"DUBLIN":["Bladen"],"DUCK":["Dare"],"DUDLEY":["Wayne"],"DUNDARRACH":["Hoke"],"DUNN":["Harnett"],"DURHAM":["Durham","Orange","Wake"],"EARL":["Cleveland"],"EAST ARCADIA":["Bladen"],"EAST BEND":["Yadkin"],"EAST FLAT ROCK":["Henderson"],"EAST LAURINBURG":["Scotland"],"EAST ROCKINGHAM":["Richmond"],"EAST SPENCER":["Rowan"],"EASTOVER":["Cumberland"],"EDEN":["Rockingham"],"EDENTON":["Chowan"],"EDNEYVILLE":["Henderson"],"EFLAND":["Orange"],"ELIZABETH CITY":["Camden","Pasquotank"],"ELIZABETHTOWN":["Bladen"],"ELK PARK":["Avery"],"ELKIN":["Surry","Wilkes"],"ELLENBORO":["Rutherford"],"ELLERBE":["Richmond"],"ELM CITY":["Nash","Wilson"],"ELON":["Alamance"],"ELROD":["Robeson"],"ELROY":["Wayne"],"EMERALD ISLE":["Carteret"],"EMMA":["Buncombe"],"ENFIELD":["Halifax"],"ENGELHARD":["Hyde"],"ENOCHVILLE":["Rowan"],"ERWIN":["Harnett"],"ETOWAH":["Henderson"],"EUREKA":["Wayne"],"EVERETTS":["Martin"],"EVERGREEN":["Columbus"],"FAIR BLUFF":["Columbus"],"FAIRFIELD":["Hyde"],"FAIRFIELD HARBOUR":["Craven"],"FAIRMONT":["Robeson"],"FAIRPLAINS":["Wilkes"],"FAIRVIEW":["Buncombe","Union"],"FAISON":["Duplin","Sampson"],"FAITH":["Rowan"],"FALCON":["Cumberland","Sampson"],"FALKLAND":["Pitt"],"FALLSTON":["Cleveland"],"FARMINGTON":["Davie"],"FARMVILLE":["Pitt"],"FAYETTEVILLE":["Cumberland"],"FEARRINGTON VILLAGE":["Chatham"],"FIVE POINTS":["Hoke"],"FLAT ROCK":["Henderson","Surry"],"FLETCHER":["Henderson"],"FONTANA DAM":["Graham"],"FOREST CITY":["Rutherford"],"FOREST HILLS":["Jackson"],"FOREST OAKS":["Guilford"],"FOSCOE":["Watauga"],"FOUNTAIN":["Pitt"],"FOUR OAKS":["Johnston"],"FOXFIRE":["Moore"],"FRANKLIN":["Macon"],"FRANKLINTON":["Franklin"],"FRANKLINVILLE":["Randolph"],"FREMONT":["Wayne"],"FRISCO":["Dare"],"FRUITLAND":["Henderson"],"FUQUAY-VARINA":["Harnett","Wake"],"GAMEWELL":["Caldwell"],"GARLAND":["Sampson"],"GARNER":["Wake"],"GARYSBURG":["Northampton"],"GASTON":["Northampton"],"GASTONIA":["Gaston"],"GATESVILLE":["Gates"],"GERMANTON":["Forsyth","Stokes"],"GERTON":["Henderson"],"GIBSON":["Scotland"],"GIBSONVILLE":["Alamance","Guilford"],"GLEN ALPINE":["Burke"],"GLEN RAVEN":["Alamance"],"GLENVILLE":["Jackson"],"GLENWOOD":["McDowell"],"GLOUCESTER":["Carteret"],"GODWIN":["Cumberland"],"GOLD HILL":["Rowan"],"GOLDSBORO":["Wayne"],"GOLDSTON":["Chatham"],"GORMAN":["Durham"],"GOVERNORS CLUB":["Chatham"],"GOVERNORS VILLAGE":["Chatham"],"GRAHAM":["Alamance"],"GRAINGERS":["Lenoir"],"GRANDFATHER VILLAGE":["Avery"],"GRANDY":["Currituck"],"GRANITE FALLS":["Caldwell"],"GRANITE QUARRY":["Rowan"],"GRANTSBORO":["Pamlico"],"GREEN LEVEL":["Alamance"],"GREENEVERS":["Duplin"],"GREENSBORO":["Guilford"],"GREENVILLE":["Pitt"],"GRIFTON":["Lenoir","Pitt"],"GRIMESLAND":["Pitt"],"GROVER":["Cleveland"],"GULF":["Chatham"],"HALF MOON":["Onslow"],"HALIFAX":["Halifax"],"HALLSBORO":["Columbus"],"HAMILTON":["Martin"],"HAMLET":["Richmond"],"HAMPSTEAD":["Pender"],"HARKERS ISLAND":["Carteret"],"HARMONY":["Iredell"],"HARRELLS":["Duplin","Sampson"],"HARRELLSVILLE":["Hertford"],"HARRISBURG":["Cabarrus"],"HASSELL":["Martin"],"HATTERAS":["Dare"],"HAVELOCK":["Craven"],"HAW RIVER":["Alamance"],"HAYESVILLE":["Clay"],"HAYS":["Wilkes"],"HEMBY BRIDGE":["Union"],"HENDERSON":["Vance"],"HENDERSONVILLE":["Henderson"],"HENRIETTA":["Rutherford"],"HERTFORD":["Perquimans"],"HICKORY":["Burke","Caldwell","Catawba"],"HIDDENITE":["Alexander"],"HIGH POINT":["Davidson","Forsyth","Guilford","Randolph"],"HIGH SHOALS":["Gaston"],"HIGHLANDS":["Jackson","Macon"],"HIGHTSVILLE":["New Hanover"],"HILDEBRAN":["Burke"],"HILLSBOROUGH":["Orange"],"HOBGOOD":["Halifax"],"HOBUCKEN":["Pamlico"],"HOFFMAN":["Richmond"],"HOLDEN BEACH":["Brunswick"],"HOLLISTER":["Halifax"],"HOLLY RIDGE":["Onslow"],"HOLLY SPRINGS":["Wake"],"HOOKERTON":["Greene"],"HOOPERS CREEK":["Henderson"],"HOPE MILLS":["Cumberland"],"HORSE SHOE":["Henderson"],"HOT SPRINGS":["Madison"],"HUDSON":["Caldwell"],"HUNTERSVILLE":["Mecklenburg"],"ICARD":["Burke"],"INDIAN BEACH":["Carteret"],"INDIAN TRAIL":["Union"],"INGOLD":["Sampson"],"IRON STATION":["Lincoln"],"IVANHOE":["Sampson"],"JAARS":["Union"],"JACKSON":["Northampton"],"JACKSON HEIGHTS":["Lenoir"],"JACKSON SPRINGS":["Moore"],"JACKSONVILLE":["Onslow"],"JAMES CITY":["Craven"],"JAMESTOWN":["Guilford"],"JAMESVILLE":["Martin"],"JEFFERSON":["Ashe"],"JONESVILLE":["Yadkin"],"KANNAPOLIS":["Cabarrus","Rowan"],"KEENER":["Sampson"],"KELFORD":["Bertie"],"KELLY":["Bladen"],"KENANSVILLE":["Duplin"],"KENLY":["Johnston","Wilson"],"KERNERSVILLE":["Forsyth","Guilford"],"KILL DEVIL HILLS":["Dare"],"KING":["Forsyth","Stokes"],"KINGS GRANT":["New Hanover"],"KINGS MOUNTAIN":["Cleveland","Gaston"],"KINGSTOWN":["Cleveland"],"KINSTON":["Lenoir"],"KITTRELL":["Vance"],"KITTY HAWK":["Dare"],"KNIGHTDALE":["Wake"],"KURE BEACH":["New Hanover"],"LA GRANGE":["Lenoir"],"LAKE JUNALUSKA":["Haywood"],"LAKE LURE":["Rutherford"],"LAKE NORMAN OF CATAWBA":["Catawba"],"LAKE NORMAN OF IREDELL":["Iredell"],"LAKE PARK":["Union"],"LAKE ROYALE":["Franklin"],"LAKE SANTEETLAH":["Graham"],"LAKE WACCAMAW":["Columbus"],"LANDIS":["Rowan"],"LANSING":["Ashe"],"LASKER":["Northampton"],"LATTIMORE":["Cleveland"],"LAUREL HILL":["Scotland"],"LAUREL PARK":["Henderson"],"LAURINBURG":["Scotland"],"LAWNDALE":["Cleveland"],"LEGGETT":["Edgecombe"],"LELAND":["Brunswick"],"LENOIR":["Caldwell"],"LEWISTON WOODVILLE":["Bertie"],"LEWISVILLE":["Forsyth"],"LEXINGTON":["Davidson"],"LIBERTY":["Randolph"],"LIGHT OAK":["Cleveland"],"LILESVILLE":["Anson"],"LILLINGTON":["Harnett"],"LINCOLNTON":["Lincoln"],"LINDEN":["Cumberland"],"LINVILLE":["Avery"],"LITTLETON":["Halifax"],"LOCUST":["Cabarrus","Stanly"],"LONG CREEK":["Pender"],"LONG VIEW":["Burke","Catawba"],"LOUISBURG":["Franklin"],"LOVE VALLEY":["Iredell"],"LOWELL":["Gaston"],"LOWESVILLE":["Lincoln"],"LOWGAP":["Surry"],"LUCAMA":["Wilson"],"LUMBER BRIDGE":["Robeson"],"LUMBERTON":["Robeson"],"MACCLESFIELD":["Edgecombe"],"MACON":["Warren"],"MADISON":["Rockingham"],"MAGGIE VALLEY":["Haywood"],"MAGNOLIA":["Duplin"],"MAIDEN":["Catawba","Lincoln"],"MAMERS":["Harnett"],"MANNS HARBOR":["Dare"],"MANTEO":["Dare"],"MAR-MAC":["Wayne"],"MARBLE":["Cherokee"],"MARIETTA":["Robeson"],"MARION":["McDowell"],"MARS HILL":["Madison"],"MARSHALL":["Madison"],"MARSHALLBERG":["Carteret"],"MARSHVILLE":["Union"],"MARVIN":["Union"],"MATTHEWS":["Mecklenburg"],"MAURY":["Greene"],"MAXTON":["Robeson","Scotland"],"MAYODAN":["Rockingham"],"MAYSVILLE":["Jones"],"MCADENVILLE":["Gaston"],"MCDONALD":["Robeson"],"MCFARLAN":["Anson"],"MCLEANSVILLE":["Guilford"],"MEBANE":["Alamance","Orange"],"MESIC":["Pamlico"],"MICRO":["Johnston"],"MIDDLEBURG":["Vance"],"MIDDLESEX":["Nash"],"MIDLAND":["Cabarrus","Mecklenburg"],"MIDWAY":["Davidson"],"MILLERS CREEK":["Wilkes"],"MILLINGPORT":["Stanly"],"MILLS RIVER":["Henderson"],"MILTON":["Caswell"],"MILWAUKEE":["Northampton"],"MINERAL SPRINGS":["Union"],"MINNESOTT BEACH":["Pamlico"],"MINT HILL":["Mecklenburg","Union"],"MISENHEIMER":["Stanly"],"MOCKSVILLE":["Davie"],"MOMEYER":["Nash"],"MONCURE":["Chatham"],"MONROE":["Union"],"MONTREAT":["Buncombe"],"MOORESBORO":["Cleveland"],"MOORESVILLE":["Iredell"],"MORAVIAN FALLS":["Wilkes"],"MOREHEAD CITY":["Carteret"],"MORGANTON":["Burke"],"MORRISVILLE":["Durham","Wake"],"MORVEN":["Anson"],"MOUNT AIRY":["Surry"],"MOUNT GILEAD":["Montgomery"],"MOUNT HOLLY":["Gaston"],"MOUNT OLIVE":["Duplin","Wayne"],"MOUNT PLEASANT":["Cabarrus"],"MOUNTAIN HOME":["Henderson"],"MOUNTAIN VIEW":["Catawba"],"MOYOCK":["Currituck"],"MULBERRY":["Wilkes"],"MURFREESBORO":["Hertford"],"MURPHY":["Cherokee"],"MURRAYSVILLE":["New Hanover"],"MYRTLE GROVE":["New Hanover"],"NAGS HEAD":["Dare"],"NASHVILLE":["Nash"],"NAVASSA":["Brunswick"],"NEBO":["McDowell"],"NEUSE FOREST":["Craven"],"NEW BERN":["Craven"],"NEW HOPE":["Wayne"],"NEW LONDON":["Stanly"],"NEWLAND":["Avery"],"NEWPORT":["Carteret"],"NEWTON":["Catawba"],"NEWTON GROVE":["Sampson"],"NORLINA":["Warren"],"NORMAN":["Richmond"],"NORTH TOPSAIL BEACH":["Onslow"],"NORTH WILKESBORO":["Wilkes"],"NORTHCHASE":["New Hanover"],"NORTHLAKES":["Caldwell"],"NORTHWEST":["Brunswick"],"NORWOOD":["Stanly"],"OAK CITY":["Martin"],"OAK ISLAND":["Brunswick"],"OAK RIDGE":["Guilford"],"OAKBORO":["Stanly"],"OCEAN ISLE BEACH":["Brunswick"],"OCRACOKE":["Hyde"],"OGDEN":["New Hanover"],"OLD FORT":["McDowell"],"OLD HUNDRED":["Scotland"],"ORIENTAL":["Pamlico"],"ORRUM":["Robeson"],"OSSIPEE":["Alamance"],"OXFORD":["Granville"],"PANTEGO":["Beaufort"],"PARKTON":["Robeson"],"PARMELE":["Martin"],"PATTERSON SPRINGS":["Cleveland"],"PEACHLAND":["Anson"],"PELETIER":["Carteret"],"PEMBROKE":["Robeson"],"PIKEVILLE":["Wayne"],"PILOT MOUNTAIN":["Surry"],"PINE KNOLL SHORES":["Carteret"],"PINE LEVEL":["Johnston"],"PINEBLUFF":["Moore"],"PINEHURST":["Moore"],"PINETOPS":["Edgecombe"],"PINETOWN":["Beaufort"],"PINEVILLE":["Mecklenburg"],"PINEY GREEN":["Onslow"],"PINK HILL":["Lenoir"],"PINNACLE":["Stokes"],"PITTSBORO":["Chatham"],"PLAIN VIEW":["Sampson"],"PLEASANT GARDEN":["Guilford"],"PLEASANT HILL":["Wilkes"],"PLYMOUTH":["Washington"],"POLKTON":["Anson"],"POLKVILLE":["Cleveland"],"POLLOCKSVILLE":["Jones"],"PORTERS NECK":["New Hanover"],"POTTERS HILL":["Duplin"],"POWELLSVILLE":["Bertie"],"PRINCETON":["Johnston"],"PRINCEVILLE":["Edgecombe"],"PROCTORVILLE":["Robeson"],"PROSPECT":["Robeson"],"PUMPKIN CENTER":["Onslow"],"RAEFORD":["Hoke"],"RAEMON":["Robeson"],"RALEIGH":["Durham","Wake"],"RAMSEUR":["Randolph"],"RANDLEMAN":["Randolph"],"RANLO":["Gaston"],"RAYNHAM":["Robeson"],"RED CROSS":["Stanly"],"RED OAK":["Nash"],"RED SPRINGS":["Hoke","Robeson"],"REIDSVILLE":["Rockingham"],"RENNERT":["Robeson"],"REX":["Robeson"],"RHODHISS":["Burke","Caldwell"],"RICH SQUARE":["Northampton"],"RICHFIELD":["Stanly"],"RICHLANDS":["Onslow"],"RIEGELWOOD":["Columbus"],"RIVER BEND":["Craven"],"RIVER ROAD":["Beaufort"],"ROANOKE RAPIDS":["Halifax"],"ROBBINS":["Moore"],"ROBBINSVILLE":["Graham"],"ROBERDEL":["Richmond"],"ROBERSONVILLE":["Martin"],"ROCKFISH":["Hoke"],"ROCKINGHAM":["Richmond"],"ROCKWELL":["Rowan"],"ROCKY MOUNT":["Edgecombe","Nash"],"ROCKY POINT":["Pender"],"RODANTHE":["Dare"],"ROLESVILLE":["Wake"],"RONDA":["Wilkes"],"ROPER":["Washington"],"ROSE HILL":["Duplin"],"ROSEBORO":["Sampson"],"ROSMAN":["Transylvania"],"ROUGEMONT":["Durham","Person"],"ROWLAND":["Robeson"],"ROXBORO":["Person"],"ROXOBEL":["Bertie"],"ROYAL PINES":["Buncombe"],"RUFFIN":["Rockingham"],"RURAL HALL":["Forsyth"],"RUTH":["Rutherford"],"RUTHERFORD COLLEGE":["Burke","Caldwell"],"RUTHERFORDTON":["Rutherford"],"SALEM":["Burke"],"SALEMBURG":["Sampson"],"SALISBURY":["Rowan"],"SALUDA":["Henderson","Polk"],"SALVO":["Dare"],"SANDY CREEK":["Brunswick"],"SANDYFIELD":["Columbus"],"SANFORD":["Lee"],"SARATOGA":["Wilson"],"SAWMILLS":["Caldwell"],"SAXAPAHAW":["Alamance"],"SCOTCH MEADOWS":["Scotland"],"SCOTLAND NECK":["Halifax"],"SEA BREEZE":["New Hanover"],"SEABOARD":["Northampton"],"SEAGROVE":["Randolph"],"SEDALIA":["Guilford"],"SELMA":["Johnston"],"SEVEN DEVILS":["Avery","Watauga"],"SEVEN LAKES":["Moore"],"SEVEN SPRINGS":["Wayne"],"SEVERN":["Northampton"],"SHALLOTTE":["Brunswick"],"SHANNON":["Robeson"],"SHARPSBURG":["Edgecombe","Nash","Wilson"],"SHELBY":["Cleveland"],"SILER CITY":["Chatham"],"SILVER CITY":["Hoke"],"SILVER LAKE":["New Hanover"],"SIMPSON":["Pitt"],"SIMS":["Wilson"],"SKIPPERS CORNER":["New Hanover"],"SMITHFIELD":["Johnston"],"SMITHTOWN":["Yadkin"],"SNEADS FERRY":["Onslow"],"SNOW HILL":["Greene"],"SOUTH HENDERSON":["Vance"],"SOUTH MILLS":["Camden"],"SOUTH ROSEMARY":["Halifax"],"SOUTH WELDON":["Halifax"],"SOUTHERN PINES":["Moore"],"SOUTHERN SHORES":["Dare"],"SOUTHMONT":["Davidson"],"SOUTHPORT":["Brunswick"],"SPARTA":["Alleghany"],"SPEED":["Edgecombe"],"SPENCER":["Rowan"],"SPENCER MOUNTAIN":["Gaston"],"SPINDALE":["Rutherford"],"SPIVEY'S CORNER":["Sampson"],"SPOUT SPRINGS":["Harnett"],"SPRING HOPE":["Nash"],"SPRING LAKE":["Cumberland"],"SPRINGDALE":["Gaston"],"SPRUCE PINE":["Mitchell"],"ST. HELENA":["Pender"],"ST. JAMES":["Brunswick"],"ST. PAULS":["Robeson"],"ST. STEPHENS":["Catawba"],"STALEY":["Randolph"],"STALLINGS":["Mecklenburg","Union"],"STANFIELD":["Stanly"],"STANLEY":["Gaston"],"STANTONSBURG":["Wilson"],"STAR":["Montgomery"],"STATESVILLE":["Iredell"],"STEDMAN":["Cumberland"],"STEM":["Granville"],"STOKES":["Pitt"],"STOKESDALE":["Guilford"],"STONEVILLE":["Rockingham"],"STONEWALL":["Pamlico"],"STONY POINT":["Alexander","Iredell"],"STOVALL":["Granville"],"SUGAR MOUNTAIN":["Avery"],"SUMMERFIELD":["Guilford"],"SUNBURY":["Gates"],"SUNSET BEACH":["Brunswick"],"SURF CITY":["Onslow","Pender"],"SWAN QUARTER":["Hyde"],"SWANNANOA":["Buncombe"],"SWANSBORO":["Onslow"],"SWEPSONVILLE":["Alamance"],"SYLVA":["Jackson"],"TABOR CITY":["Columbus"],"TAR HEEL":["Bladen"],"TARBORO":["Edgecombe"],"TAYLORSVILLE":["Alexander"],"TAYLORTOWN":["Moore"],"TEACHEY":["Duplin"],"THOMASVILLE":["Davidson","Randolph"],"TOAST":["Surry"],"TOBACCOVILLE":["Forsyth","Stokes"],"TOPSAIL BEACH":["Pender"],"TRENT WOODS":["Craven"],"TRENTON":["Jones"],"TRINITY":["Randolph"],"TROUTMAN":["Iredell"],"TROY":["Montgomery"],"TRYON":["Polk"],"TURKEY":["Sampson"],"TYRO":["Davidson"],"UNIONVILLE":["Union"],"VALDESE":["Burke"],"VALLE CRUCIS":["Watauga"],"VALLEY HILL":["Henderson"],"VANCEBORO":["Craven"],"VANDEMERE":["Pamlico"],"VANDER":["Cumberland"],"VANN CROSSROADS":["Sampson"],"VARNAMTOWN":["Brunswick"],"VASS":["Moore"],"WACO":["Cleveland"],"WADE":["Cumberland"],"WADESBORO":["Anson"],"WAGRAM":["Scotland"],"WAKE FOREST":["Franklin","Wake"],"WAKULLA":["Robeson"],"WALKERTOWN":["Forsyth"],"WALLACE":["Duplin","Pender"],"WALLBURG":["Davidson"],"WALNUT COVE":["Stokes"],"WALNUT CREEK":["Wayne"],"WALSTONBURG":["Greene"],"WANCHESE":["Dare"],"WARRENTON":["Warren"],"WARSAW":["Duplin"],"WASHINGTON":["Beaufort"],"WASHINGTON PARK":["Beaufort"],"WATHA":["Pender"],"WAVES":["Dare"],"WAXHAW":["Union"],"WAYNESVILLE":["Haywood"],"WEAVERVILLE":["Buncombe"],"WEBSTER":["Jackson"],"WEDDINGTON":["Mecklenburg","Union"],"WELCOME":["Davidson"],"WELDON":["Halifax"],"WENDELL":["Wake"],"WENTWORTH":["Rockingham"],"WESLEY CHAPEL":["Union"],"WEST CANTON":["Haywood"],"WEST JEFFERSON":["Ashe"],"WEST MARION":["McDowell"],"WESTPORT":["Lincoln"],"WHISPERING PINES":["Moore"],"WHITAKERS":["Edgecombe","Nash"],"WHITE LAKE":["Bladen"],"WHITE OAK":["Bladen"],"WHITE PLAINS":["Surry"],"WHITEVILLE":["Columbus"],"WHITSETT":["Guilford"],"WHITTIER":["Jackson"],"WILKESBORO":["Wilkes"],"WILLIAMSTON":["Martin"],"WILMINGTON":["New Hanover"],"WILSON":["Wilson"],"WILSON'S MILLS":["Johnston"],"WINDSOR":["Bertie"],"WINFALL":["Perquimans"],"WINGATE":["Union"],"WINSTON-SALEM":["Forsyth"],"WINTERVILLE":["Pitt"],"WINTON":["Hertford"],"WOODFIN":["Buncombe"],"WOODLAND":["Northampton"],"WOODLAWN":["Alamance"],"WRIGHTSBORO":["New Hanover"],"WRIGHTSVILLE BEACH":["New Hanover"],"YADKIN COLLEGE":["Davidson"],"YADKINVILLE":["Yadkin"],"YANCEYVILLE":["Caswell"],"YOUNGSVILLE":["Franklin"],"ZEBULON":["Johnston","Wake"]};

const SUFFIX = new Set(["ST","STREET","DR","DRIVE","RD","ROAD","AVE","AVENUE","LN","LANE","CT","COURT",
  "CIR","CIRCLE","BLVD","BOULEVARD","WAY","PL","PLACE","TRL","TRAIL","PKWY","PARKWAY","HWY","HIGHWAY",
  "TER","TERRACE","LOOP","RUN","XING","CROSSING","SQ","SQUARE"]);

// "2000 Spring Garden St, Greensboro, NC" without the city matches the first 2000 Spring
// Garden in the state, which was Craven County. The city is not decoration.
const STATES = new Set(["NC","NORTH CAROLINA","US","USA"]);
function cityOf(raw) {
  const parts = String(raw || "").split(",").slice(1)
    .map(x => x.toUpperCase().replace(/[^A-Z ]/g, "").trim()).filter(Boolean);
  const city = parts.find(x => x && !STATES.has(x) && x.length > 2);
  return city ? city.slice(0, 30) : "";
}
function streetOf(raw) {
  const full = String(raw || "").split(",")[0].toUpperCase()
    .replace(/[^A-Z0-9 ]/g, "").replace(/\s+/g, " ").trim().slice(0, 60);
  const toks = full.split(" ").filter(Boolean);
  while (toks.length > 2 && SUFFIX.has(toks[toks.length - 1])) toks.pop();
  return toks.join(" ");
}
function n(v) {
  const x = typeof v === "string" ? parseFloat(v.replace(/[^0-9.\-]/g, "")) : v;
  return typeof x === "number" && isFinite(x) && x !== 0 ? x : null;
}
function iso(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") { const d = new Date(v); return isNaN(d) ? null : d.toISOString().slice(0, 10); }
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  return isNaN(d) ? null : d.toISOString().slice(0, 10);
}
async function getJson(url, headers, body) {
  const opt = { headers: Object.assign({}, UA, headers || {}) };
  if (body !== undefined) {
    opt.method = "POST";
    opt.headers["Content-Type"] = "application/json";
    opt.body = JSON.stringify(body);
  }
  const r = await fetch(url, opt);
  if (!r.ok) throw new Error("upstream " + r.status);
  return r.json();
}
function agQuery(base, where, fields, count, headers) {
  const u = base + "?where=" + encodeURIComponent(where) + "&outFields=" + fields +
    "&returnGeometry=false&resultRecordCount=" + (count || 1) + "&f=json";
  return getJson(u, headers);
}

// A conveyance that was never a sale tells you nothing about value, and a comparable built
// on one is worse than no comparable. The deed type is the first filter; a zero excise
// stamp on a transfer of real property is the second.
const NOT_ARMS = /QUIT ?CLAIM|TRUSTEE|SUBSTITUTE|FORECLOS|EXECUTOR|ADMINISTRAT|ESTATE|GIFT|TAX DEED|SHERIFF|COMMISSIONER|CORRECT|TIMBER|EASEMENT|DIVORCE|SEPARAT/i;
function armsLength(type, price, stamps) {
  if (type && NOT_ARMS.test(type)) return false;
  if (!price && !stamps) return false;
  return true;
}
function saleRow(o) {
  const stamps = n(o.stamps);
  const stated = n(o.price);
  const stampPrice = stamps ? Math.round(stamps * 500) : null;   // NCGS 105-228.30
  return {
    date: iso(o.date), price: stated, stamps: stamps, stampPrice: stampPrice,
    book: o.book || null, page: o.page || null, type: o.type || null,
    armsLength: armsLength(o.type, stated, stamps),
    agrees: (stated && stampPrice) ? Math.abs(stated - stampPrice) <= 500 : null
  };
}

/* ---------------- tier 1a: Wake ---------------- */
async function wake(street) {
  const j = await agQuery(
    "https://maps.wake.gov/arcgis/rest/services/Property/Parcels/MapServer/0/query",
    "SITE_ADDRESS LIKE '" + street.replace(/'/g, "''") + "%'",
    "SITE_ADDRESS,PIN_NUM,DEED_BOOK,DEED_PAGE,DEED_DATE,LAND_VAL,BLDG_VAL,TOTAL_VALUE_ASSD," +
    "TOTSALPRICE,SALE_DATE,YEAR_BUILT,HEATEDAREA,TOTUNITS,TOTSTRUCTS,TYPE_USE_DECODE," +
    "DESIGN_STYLE_DECODE,LAND_CLASS_DECODE,DEED_ACRES");
  const f = (j.features || [])[0];
  if (!f) return null;
  const a = f.attributes;
  return {
    county: "Wake", pin: a.PIN_NUM || null, address: a.SITE_ADDRESS || null,
    source: "Wake County parcel record (the county's own GIS)", depth: "deep",
    assessed: { land: n(a.LAND_VAL), building: n(a.BLDG_VAL), total: n(a.TOTAL_VALUE_ASSD) },
    building: { heatedArea: n(a.HEATEDAREA), yearBuilt: n(a.YEAR_BUILT), units: n(a.TOTUNITS),
                structures: n(a.TOTSTRUCTS), style: a.DESIGN_STYLE_DECODE || null },
    land: { acres: n(a.DEED_ACRES), use: a.TYPE_USE_DECODE || a.LAND_CLASS_DECODE || null },
    sales: [saleRow({ date: a.SALE_DATE, price: a.TOTSALPRICE, book: a.DEED_BOOK, page: a.DEED_PAGE })]
             .filter(s => s.date || s.price),
    deed: { book: (a.DEED_BOOK || "").replace(/^0+(?=\d)/, "") || null,
            page: (a.DEED_PAGE || "").replace(/^0+(?=\d)/, "") || null,
            recorded: iso(a.DEED_DATE) }
  };
}

/* ---------------- tier 1b: Mecklenburg ---------------- */
async function meck(street) {
  const H = { Referer: "https://meckgis.mecklenburgcountync.gov/" };
  const B = "https://meckgis.mecklenburgcountync.gov/server/rest/services/TaxParcel_camadata/MapServer/0/query";
  const j = await agQuery(B, "UPPER(address) LIKE '" + street.replace(/'/g, "''") + "%'", "*", 1, H);
  const f = (j.features || [])[0];
  if (!f) return null;
  const a = f.attributes;
  const out = {
    county: "Mecklenburg", pin: a.pid || a.parcelid || null, address: a.address || null,
    source: "Mecklenburg County CAMA parcel data (the county's own GIS)", depth: "deep",
    assessed: { land: n(a.totlandval), building: n(a.totalbldgval),
                total: n(a.totalvalue) || n(a.totmarkval) },
    building: { heatedArea: n(a.heatedarea) },
    land: { acres: n(a.legalacres) || n(a.totalac), use: a.landuse_description || null,
            neighborhood: a.neighbordesc || null },
    sales: [], deed: { book: a.deed_book || null, page: a.deed_page || null }
  };
  try {
    const S = "https://meckgis.mecklenburgcountync.gov/server/rest/services/TaxParcelSales/MapServer/0/query";
    const js = await agQuery(S, "parcelid='" + String(out.pin).replace(/'/g, "") + "'",
      "saleprice,saledate,deeddescription,legalreference,salesvalidity,naldesc", 12, H);
    out.sales = (js.features || []).map(x => x.attributes)
      .map(s => {
        const row = saleRow({ date: s.saledate, price: s.saleprice, type: s.deeddescription });
        // Mecklenburg publishes its own arms-length judgement; it beats my regex
        if (s.naldesc) { row.armsLength = false; row.note = s.naldesc; }
        if (s.legalreference) row.reference = s.legalreference;
        return row;
      })
      .sort((x, y) => String(y.date || "").localeCompare(String(x.date || "")));
  } catch (e) {}
  if (!out.sales.length && (a.saleprice || a.saledate)) {
    out.sales = [saleRow({ date: a.saledate, price: a.saleprice,
                           book: a.deed_book, page: a.deed_page, type: a.naldesc })];
  }
  return out;
}

/* ---------------- tier 1c: Cumberland ----------------
   The deepest single parcel record published by any county in the state, and the only one
   that publishes bathrooms. Everywhere else a bathroom adjustment has nothing to stand on.
   Two things about this table are easy to read wrong and are handled here rather than
   left to the reader:
     - ADDRESS is the owner's mailing address, which is often a post office box. The
       address of the house is LOCATION_ADDR. Matching on ADDRESS returns the wrong parcel.
     - TOTAL_PROP_VALUE is the value the assessor settled on, by whichever approach
       VALUE_APPROACH names. TOTAL_LAND_VALUE_ASSESSED and TOTAL_BLDG_VALUE_ASSESSED are
       the cost-approach components and do not have to add up to it. Treating their sum as
       the total, or the total as their sum, produces a land share that is simply wrong. */
const CUMB = "https://gis.co.cumberland.nc.us/server/rest/services/Tax/Parcels/MapServer/0/query";
const CUMB_F = "PIN,LOCATION_ADDR,CITY,ZIP,ACREAGE,ZONING,LAND_CLASS,NEIGHBORHOOD,VCS,TOWNSHIP," +
  "HEATED_AREA,GROSS_LEASABLE_AREA,BEDROOMS,BATH_FULL,BATH_HALF,YEAR_BUILT,EFF_YEAR,GRADE," +
  "CONDITION,BLDG_DESC,BLDG_TYPE,STORY_HEIGHT,UNITS,TOTAL_UNITS," +
  "TOTAL_PROP_VALUE,TOTAL_LAND_VALUE_ASSESSED,TOTAL_BLDG_VALUE_ASSESSED,TOTAL_OBLDG_VALUE," +
  "COST_TOTAL_VALUE,INCOME_TOTAL_VALUE,SALES_COMP_TOTAL_VALUE,VALUE_APPROACH," +
  "USE_VALUE_DEFERRED,HISTORIC_VALUE_DEFERRED,TOTAL_DEFERRED_VALUE,VETRANS_EXCL,ELDERLY_EXCL," +
  "EXEMPTION_DESC,PKG_SALE_PRICE,PKG_SALE_DATE,LAND_SALE_PRICE,LAND_SALE_DATE," +
  "REVENUE_STAMPS,DEED_BOOK,DEED_PAGE,DEED_DATE,PLAT_BOOK,PLAT_PAGE,PERMIT_DATE,PERMIT_NUMBER," +
  "IS_PENDING,ETJ,FIRE_DISTRICT";

const APPROACH = { VLAPSALESCOMP: "the sales comparison approach", VLAPCOST: "the cost approach",
                   VLAPINCOME: "the income approach" };

async function cumberland(street) {
  const s = street.replace(/'/g, "''");
  let j = await agQuery(CUMB, "LOCATION_ADDR LIKE '" + s + "%'", CUMB_F, 3);
  let f = (j.features || [])[0];
  if (!f) {                                   // "123 N Main" against a table that splits the prefix
    const t = s.split(" ");
    if (t.length > 2) {
      j = await agQuery(CUMB, "PHYADDR_STR_NUM='" + t[0] + "' AND PHYADDR_STR LIKE '" +
        t.slice(1).join(" ") + "%'", CUMB_F, 3);
      f = (j.features || [])[0];
    }
  }
  if (!f) return null;
  const a = f.attributes;
  const land = n(a.TOTAL_LAND_VALUE_ASSESSED), bldg = n(a.TOTAL_BLDG_VALUE_ASSESSED);
  const out = {
    county: "Cumberland", pin: a.PIN || null, address: a.LOCATION_ADDR || null,
    city: a.CITY || null, zip: a.ZIP || null,
    source: "Cumberland County tax parcel record (the county's own GIS)", depth: "deep",
    assessed: {
      land: land, building: bldg, total: n(a.TOTAL_PROP_VALUE),
      otherBuildings: n(a.TOTAL_OBLDG_VALUE),
      // the assessor's own components are the defensible allocation for depreciation,
      // whatever total the chosen approach landed on
      landShare: (land && bldg) ? Math.round((land / (land + bldg)) * 1000) / 10 : null,
      byCost: n(a.COST_TOTAL_VALUE), byIncome: n(a.INCOME_TOTAL_VALUE),
      bySalesComparison: n(a.SALES_COMP_TOTAL_VALUE),
      approach: APPROACH[a.VALUE_APPROACH] || a.VALUE_APPROACH || null,
      deferred: n(a.TOTAL_DEFERRED_VALUE),
      exemption: str0(a.EXEMPTION_DESC),
      veteranExclusion: str0(a.VETRANS_EXCL), elderlyExclusion: str0(a.ELDERLY_EXCL),
      pendingAppeal: a.IS_PENDING === "Y" || null
    },
    building: {
      heatedArea: n(a.HEATED_AREA), grossLeasableArea: n(a.GROSS_LEASABLE_AREA),
      bedrooms: n(a.BEDROOMS), bathsFull: n(a.BATH_FULL),
      bathsHalf: a.BATH_HALF == null || a.BATH_HALF === "" ? null : (parseInt(a.BATH_HALF, 10) || 0),
      yearBuilt: n(a.YEAR_BUILT), effectiveYear: n(a.EFF_YEAR),
      grade: str0(a.GRADE), condition: str0(a.CONDITION),
      style: str0(a.BLDG_DESC) || str0(a.BLDG_TYPE), storyHeight: str0(a.STORY_HEIGHT),
      units: n(a.TOTAL_UNITS) || n(a.UNITS)
    },
    land: {
      acres: n(a.ACREAGE), use: str0(a.LAND_CLASS), zoning: str0(a.ZONING),
      neighborhood: str0(a.NEIGHBORHOOD), marketArea: str0(a.VCS),
      township: str0(a.TOWNSHIP), jurisdiction: str0(a.ETJ)
    },
    sales: [saleRow({ date: a.PKG_SALE_DATE, price: a.PKG_SALE_PRICE,
                      stamps: a.REVENUE_STAMPS, book: a.DEED_BOOK, page: a.DEED_PAGE })]
             .filter(x => x.date || x.price || x.stamps),
    deed: { book: (a.DEED_BOOK || "").replace(/^0+(?=\d)/, "") || null,
            page: (a.DEED_PAGE || "").replace(/^0+(?=\d)/, "") || null,
            recorded: iso(a.DEED_DATE),
            plat: a.PLAT_BOOK ? (a.PLAT_BOOK + "/" + a.PLAT_PAGE) : null },
    permit: (a.PERMIT_NUMBER && iso(a.PERMIT_DATE) && iso(a.PERMIT_DATE) > "1900-01-01")
              ? { number: a.PERMIT_NUMBER, date: iso(a.PERMIT_DATE) } : null
  };
  return out;
}
function str0(v) { const t = String(v == null ? "" : v).trim(); return t ? t : null; }

/* ---------------- tier 1c: the shared NCPTS tax platform ---------------- */
async function ncpts(tenant, street) {
  const H = { "X-Tenant": tenant };
  const s = await getJson("https://lrcpwa.ncptscloud.com/api/SimpleParcelSearch?query=" +
    encodeURIComponent(street) + "&pageIndex=0&pageSize=3", H);
  const hit = (s.results || [])[0];
  if (!hit || !hit.formattedPin) return null;
  const j = await getJson("https://lrcpwa.ncptscloud.com/api/GetParcelDetailsByQueryParam", H,
    { searchKey: "pin", searchValue: hit.formattedPin.replace(/[^0-9]/g, "") });
  const b = (j.buildings || [])[0] || {};
  const ll = (j.landLines || [])[0] || {};
  const name = tenant.charAt(0).toUpperCase() + tenant.slice(1);
  const out = {
    county: name, pin: j.formattedPin || hit.formattedPin,
    address: j.formattedPhysicalAddress || hit.propertyAddress1 || null,
    source: name + " County tax record (the shared NCPTS assessor platform)", depth: "deep",
    assessed: { land: n(j.totalLandValueAssessed), building: n(j.totalBuildingValueAssessed),
                total: n(j.totalPropertyValue) || n(hit.totalPropertyValue),
                year: j.taxYear || null,
                misc: n(j.totalMiscImprovementValueAssessed) },
    building: {
      heatedArea: n(b.heatedArea) || n(j.heatedArea),
      grossLeasableArea: n(j.grossLeasableArea),
      footprint: n(b.mainBodyFootprintArea),
      bedrooms: n(b.bedrooms), fixtures: n(b.totalFixtures),
      yearBuilt: n(b.yearBuilt), effectiveYear: n(b.effectiveYear),
      remodeledYear: n(b.remodeledYear),
      style: b.style || b.description || null, grade: b.grade || null,
      condition: b.condition || null, exterior: b.exterior || null,
      heating: b.heating || null, ac: b.airConditioning || null,
      foundation: b.foundation || null, storyHeight: b.storyHeight || null,
      units: n(b.units) || n(j.totalUnits), additions: n(b.additionCount),
      percentComplete: b.percentComplete || null,
      replacementCost: n(b.totalAdjustedReplacementValue),
      depreciatedValue: n(b.depreciatedValue),
      structures: (j.buildings || []).length || null
    },
    land: { acres: n(j.calculatedAcres) || n(j.acreage), zoning: j.zoning || ll.zoning || null,
            use: j.landClass || ll.landLineDescription || null,
            sizeDescription: ll.sizeDescription || null,
            miscImprovements: (j.miscImprovements || []).length || null },
    sales: (j.deeds || []).map(d => saleRow({
        date: d.deedDate, price: d.salePrice, stamps: d.revenueStamps,
        book: (d.book || "").replace(/^0+(?=\d)/, ""), page: (d.page || "").replace(/^0+(?=\d)/, ""),
        type: d.deedType
      })).sort((x, y) => String(y.date || "").localeCompare(String(x.date || ""))),
    deed: { book: (j.deedBook || "").replace(/^0+(?=\d)/, "") || null,
            page: (j.deedPage || "").replace(/^0+(?=\d)/, "") || null,
            recorded: iso(j.deedDate), stamps: n(j.revenueStamps) },
    links: { taxBill: j.taxBillUrl || null, map: j.mapUrl || null, deedImage: j.deedBookUrl || null },
    valueApproach: j.valueApproach || null
  };
  // the tax bill history, which is the real number Stage Two keeps asking people to guess
  try {
    const pid = j.parcelId || j.parcelPk || j.reid;
    if (pid) {
      const bs = await getJson("https://bcpwa.ncptscloud.com/api/SimpleBillSearch?query=" +
        encodeURIComponent(pid) + "&pageIndex=0&pageSize=40", H);
      const bills = (bs.results || []).filter(x => String(x.parcelId) === String(pid) &&
        /real/i.test(x.billParentType || ""));
      if (bills.length) {
        bills.sort((x, y) => Number(y.taxYear) - Number(x.taxYear));
        const unpaid = bills.filter(x => Number(x.amountDue) > 0 && /UNPAID|PARTIAL/i.test(x.billStatus || ""));
        out.tax = {
          year: bills[0].taxYear, billed: n(bills[0].originalBillAmount),
          status: bills[0].billStatus || null, amountDue: Number(bills[0].amountDue) || 0,
          history: bills.slice(0, 6).map(x => ({ year: x.taxYear, billed: n(x.originalBillAmount),
                                                 status: x.billStatus || null })),
          // the current year's bill is normally open, so it is not evidence of anything
          delinquentYears: unpaid.map(x => x.taxYear).filter(y => Number(y) < Number(bills[0].taxYear))
        };
      }
    }
  } catch (e) {}
  return out;
}

/* ---------------- tier 2: the statewide layer ---------------- */
async function onemap(street, county, city) {
  let where = "UPPER(SITEADD) LIKE '" + street.replace(/'/g, "''") + "%'";
  if (county) where += " AND UPPER(CNTYNAME) LIKE '" + county + "%'";
  else if (city) where += " AND UPPER(SCITY) LIKE '" + city.replace(/'/g, "''") + "%'";
  const j = await agQuery(
    "https://services.nconemap.gov/secure/rest/services/NC1Map_Parcels/FeatureServer/0/query",
    where,
    "SITEADD,CNTYNAME,PARNO,SOURCEREF,SOURCEDATX,LEGDECFULL,PARUSEDESC,LANDVAL,IMPROVVAL,PARVAL," +
    "SALEDATE,SALEDATETX,STRUCTYEAR,GISACRES,STRUCTNO", 3);
  const f = (j.features || [])[0];
  if (!f) return null;
  const a = {};
  Object.keys(f.attributes).forEach(k => { a[k.toLowerCase()] = f.attributes[k]; });
  const ref = a.sourceref || "";
  const m = ref.match(/(\d{2,6})\s*[\/\\, -]\s*0*(\d{1,6})/);
  return {
    county: a.cntyname || null, pin: a.parno || null, address: a.siteadd || null,
    source: "NC OneMap statewide parcels (county GIS records)", depth: "standard",
    assessed: { land: n(a.landval), building: n(a.improvval), total: n(a.parval) },
    building: { yearBuilt: n(a.structyear), structures: n(a.structno) },
    land: { acres: n(a.gisacres), use: a.parusedesc || null, legal: a.legdecfull || null },
    sales: [saleRow({ date: a.saledate || a.saledatetx })].filter(s => s.date),
    deed: { book: m ? m[1].replace(/^0+(?=\d)/, "") : null, page: m ? m[2] : null,
            recorded: iso(a.sourcedatx) || null, reference: ref || null }
  };
}

function merge(base, deep) {
  if (!base) return deep;
  if (!deep) return base;
  const out = Object.assign({}, base, deep);
  ["assessed", "building", "land", "deed", "links"].forEach(k => {
    out[k] = Object.assign({}, base[k] || {}, deep[k] || {});
    Object.keys(out[k]).forEach(x => { if (out[k][x] === null || out[k][x] === undefined) {
      if (base[k] && base[k][x] != null) out[k][x] = base[k][x];
    }});
  });
  if ((deep.sales || []).length < (base.sales || []).length) out.sales = base.sales;
  out.sources = [base.source, deep.source].filter(Boolean);
  return out;
}

/* ---------------- mode=shape: the parcel's actual polygon, for the fortress ----------------
   Same statewide layer the record tier reads, with geometry switched on and projected to
   plain latitude and longitude. Bundled here because the host allows twelve functions and
   the thirteenth kills the build silently; this is a mode, not a new endpoint. */
async function shapeHandler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "https://kpfeffer.com");
  res.setHeader("Cache-Control", "s-maxage=43200, stale-while-revalidate");
  const street = streetOf(req.query.address);
  const city = cityOf(req.query.address);
  const hint = (req.query.county || "").toString().toUpperCase().replace(/[^A-Z ]/g, "").slice(0, 30);
  if (street.length < 5 || !/^\d/.test(street)) {
    return res.status(400).json({ error: "send a street address with a number" });
  }
  const key = "shape|" + street + "|" + hint + "|" + city;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < TTL) return res.status(200).json(hit.data);
  let where = "UPPER(SITEADD) LIKE '" + street.replace(/'/g, "''") + "%'";
  if (hint) where += " AND UPPER(CNTYNAME) LIKE '" + hint + "%'";
  else if (city && PLACES[city]) where += " AND UPPER(CNTYNAME) LIKE '" + PLACES[city][0].toUpperCase() + "%'";
  else if (city) where += " AND UPPER(SCITY) LIKE '" + city.replace(/'/g, "''") + "%'";
  try {
    // Layer 1 is the polygon layer; layer 0 is points only and answers with no rings.
    const u = "https://services.nconemap.gov/secure/rest/services/NC1Map_Parcels/FeatureServer/1/query" +
      "?where=" + encodeURIComponent(where) +
      "&outFields=SITEADD,CNTYNAME,GISACRES,PARVAL,STRUCTYEAR" +
      "&returnGeometry=true&outSR=4326&resultRecordCount=1&f=json";
    const j = await getJson(u);
    const f = (j.features || [])[0];
    if (!f || !f.geometry || !f.geometry.rings || !f.geometry.rings.length) {
      return res.status(404).json({ error: "no parcel shape answered for that address" });
    }
    const rings = f.geometry.rings;
    let sx = 0, sy = 0, cnt = 0;
    rings[0].forEach(p => { sx += p[0]; sy += p[1]; cnt++; });
    const a = {};
    Object.keys(f.attributes || {}).forEach(k => { a[k.toLowerCase()] = f.attributes[k]; });
    const data = {
      address: a.siteadd || null, county: a.cntyname || null,
      acres: n(a.gisacres), assessed: n(a.parval), yearBuilt: n(a.structyear),
      centroid: cnt ? { lon: sx / cnt, lat: sy / cnt } : null,
      rings: rings,
      source: "NC OneMap statewide parcels (county GIS records)"
    };
    cache.set(key, { t: Date.now(), data });
    return res.status(200).json(data);
  } catch (e) {
    return res.status(502).json({ error: "parcel shape service unavailable" });
  }
}

export default async function handler(req, res) {
  if ((req.query.mode || "") === "comps") {
    /* The comparable-sales engine branches on the COUNTY: Wake, Mecklenburg, and
       Cumberland each have their own deep service, and everything else falls to the
       statewide layer. A caller who sends only an address therefore lost the deep
       engine entirely, which is how 702 Glenwood Dr in Fayetteville, a Cumberland
       address with 304 recorded sales in its own neighbourhood, came back as
       "no parcel matched". The city already knows its county; resolve it here. */
    if (!req.query.county) {
      const c0 = cityOf(req.query.address);
      const g0 = c0 && PLACES[c0];
      if (g0 && g0.length) req.query.county = g0[0].toUpperCase();
    }
    return compsHandler(req, res);
  }
  if ((req.query.mode || "") === "shape") return shapeHandler(req, res);
  res.setHeader("Access-Control-Allow-Origin", "https://kpfeffer.com");
  res.setHeader("Cache-Control", "s-maxage=43200, stale-while-revalidate");

  const street = streetOf(req.query.address);
  const city = cityOf(req.query.address);
  const hint = (req.query.county || "").toString().toUpperCase().replace(/[^A-Z ]/g, "").slice(0, 30);
  if (street.length < 5 || !/^\d/.test(street)) {
    return res.status(400).json({ error: "send a street address with a number" });
  }
  const key = street + "|" + hint + "|" + city;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < TTL) return res.status(200).json(hit.data);

  // Which counties could this address possibly be in? The city answers that far more
  // reliably than the parcel layer does, and a place on a county line gets all of them.
  let counties = [];
  if (hint) counties = [hint];
  else if (city && PLACES[city]) counties = PLACES[city].slice(0, 4);

  async function deepFor(countyName) {
    const C = String(countyName || "").toUpperCase();
    if (C.indexOf("WAKE") === 0) return wake(street);
    if (C.indexOf("MECKLENBURG") === 0) return meck(street);
    if (C.indexOf("CUMBERLAND") === 0) return cumberland(street);
    const t = NCPTS.find(x => C.indexOf(x.toUpperCase()) === 0);
    return t ? ncpts(t, street) : null;
  }

  try {
    let base = null, deep = null, tried = [];
    for (const c of counties) {
      tried.push(c);
      const [b, d] = await Promise.all([
        onemap(street, c.toUpperCase(), "").catch(() => null),
        deepFor(c).catch(() => null)
      ]);
      if (d) { deep = d; base = b; break; }
      if (b && !base) { base = b; }
      if (base && counties.length === 1) break;
    }
    // No city we recognise, or the city gave us nothing: fall back to the whole state and
    // say so, because a street name matched statewide is a guess about the county.
    let inferred = false;
    if (!base && !deep) {
      // The city named its county and that county answered nothing. Stopping here is the
      // honest move: falling through to an unfiltered statewide match hands back a REAL
      // parcel from a DIFFERENT county (Taylorsville used to answer with Iredell, Sylva
      // with Martin), and a silent wrong answer is worse than none.
      if (counties.length) {
        return res.status(404).json({
          error: "no parcel matched in " + counties.join(" or ") + " County",
          county: counties[0],
          honest: "The city you typed sits in " + counties.join(" or ") + " County, and that county's " +
                  "public layer returned nothing for that street. Rather than hand you a real parcel " +
                  "from a different county, the search stops here. Check the street spelling first; " +
                  "if it is right, " + counties.join(" and ") + " County is one where the public layer " +
                  "is thin and we are still updating to get there."
        });
      }
      base = await onemap(street, hint, city).catch(() => null);
      if (!base && city) { base = await onemap(street, "", "").catch(() => null); inferred = !!base; }
      const c2 = (base && base.county) || "";
      if (c2) { deep = await deepFor(c2).catch(() => null); }
    }

    const out = merge(base, deep);
    if (!out) return res.status(404).json({ error: "no parcel matched that address" });
    if (inferred) out.countyInferred = true;
    if (tried.length > 1) out.countiesConsidered = tried;

    // what the reader should know about the answer they just got
    const notes = [];
    const A = out.assessed || {};
    /* Land share for the depreciation split. Where the county publishes both components,
       land over land-plus-building is the allocation that survives a question, because the
       final assessed total may have come from a different approach entirely and need not
       equal the two parts. Falling back to land over total is only for counties that
       publish no building value at all. */
    if (A.landShare) { /* the county source already computed it from its own components */ }
    else if (A.land && A.building) out.assessed.landShare = Math.round((A.land / (A.land + A.building)) * 1000) / 10;
    else if (A.land && A.total) out.assessed.landShare = Math.round((A.land / A.total) * 1000) / 10;
    else notes.push("This county does not publish its land and building split, so the land share " +
                    "for depreciation has to be your own allocation.");
    const arms = (out.sales || []).filter(s => s.armsLength && (s.price || s.stampPrice));
    if (arms.length) {
      const last = arms[0];
      out.lastArmsLength = last;
      if (last.agrees === false) {
        notes.push("The stated price and the excise stamp on the last sale disagree, which " +
                   "usually means the stamp covered more than this parcel or the sale was partly exempt.");
      }
    } else if ((out.sales || []).length) {
      notes.push("Every transfer on file looks like something other than a sale — a quitclaim, a " +
                 "trustee's deed, an estate. Basis follows a different rule for each of those.");
    }
    const bl = out.building || {};
    if (bl.heatedArea && bl.grossLeasableArea && bl.grossLeasableArea > bl.heatedArea * 1.05) {
      notes.push("Heated area is " + bl.heatedArea + " square feet against " + bl.grossLeasableArea +
                 " total. An automated valuation that prices the total as living space will read high.");
    }
    if (bl.percentComplete && parseFloat(bl.percentComplete) < 100) {
      notes.push("The assessor has this building at " + bl.percentComplete + " percent complete.");
    }
    if (A.approach && A.byCost && A.total && Math.abs(A.byCost - A.total) > A.total * 0.02) {
      notes.push("The assessor valued this by " + A.approach + " at $" + A.total.toLocaleString() +
                 ". Its cost-approach figure for the same parcel is $" + A.byCost.toLocaleString() +
                 ". The land and building split above comes from the cost side, which is why the " +
                 "two parts do not add to the total.");
    }
    if (A.pendingAppeal) {
      notes.push("This parcel has an appeal pending on its assessment, so the assessed value " +
                 "is not settled.");
    }
    if (A.veteranExclusion) {
      notes.push("The disabled veteran exclusion is on this parcel. It runs with the owner, " +
                 "not the land, so a buyer does not inherit it and the tax line will change.");
    }
    if (A.deferred) {
      notes.push("$" + A.deferred.toLocaleString() + " of value is deferred. Deferred taxes come " +
                 "due on a change of use, and in North Carolina that bill can reach back three years.");
    }
    if (out.tax && out.tax.delinquentYears && out.tax.delinquentYears.length) {
      notes.push("Property tax is unpaid for " + out.tax.delinquentYears.join(", ") +
                 ". In North Carolina the tax lien runs with the land and outranks the mortgage.");
    }
    if (out.countyInferred) {
      notes.push("No city in the address matched a North Carolina place, so the county was taken " +
                 "from the first parcel in the state with this street name. Send the city, or the " +
                 "county, if that is wrong.");
    }
    if (out.depth === "standard") {
      notes.push("This county does not publish a parcel system I can reach directly, so this is " +
                 "the statewide layer: whatever the county chose to send to NC OneMap, and no " +
                 "building detail.");
    }
    notes.push("The mortgage itself is recorded as a deed of trust in the same register, usually " +
               "within a page or two of the deed, and its face amount is the original loan exactly. " +
               "That index is not machine readable here.");
    out.notes = notes;
    out.excise = "Sale prices marked from an excise stamp are the stamp times 500, " +
                 "at the rate set by N.C. Gen. Stat. 105-228.30.";

    cache.set(key, { t: Date.now(), data: out });
    return res.status(200).json(out);
  } catch (e) {
    return res.status(502).json({ error: "parcel service unavailable" });
  }
}

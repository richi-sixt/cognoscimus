// The user guide. Like the start page it only exists in English and German, so
// it stays out of the translation files. `{address}` is replaced by the mail
// inbox address when the server has one configured.
import type { LandingLang } from '@/components/landing/content';

export interface HelpSection {
  id: string;
  title: string;
  intro?: string;
  steps: { title: string; text: string }[];
}

export interface HelpContent {
  title: string;
  lead: string;
  toc: string;
  back: string;
  languageLabel: string;
  sections: HelpSection[];
}

export const HELP_CONTENT: Record<LandingLang, HelpContent> = {
  en: {
    title: 'User guide',
    lead: 'Cognoscimus has two parts: the library for your books and Later for what you find on the web. Both share one account, one sign-in and one username.',
    toc: 'Contents',
    back: 'Back to Cognoscimus',
    languageLabel: 'Language',
    sections: [
      {
        id: 'start',
        title: 'Getting started',
        steps: [
          {
            title: 'Sign in',
            text: 'Access is by invitation. After signing in you land in the library. The buttons "Library" and "Later" at the top switch between the two parts.',
          },
          {
            title: 'Choose a username',
            text: 'Open the account page (the person icon, or "Account" in the menu) and pick a username. It is shared by the library and Later, and it is the only name others see: your e-mail address is never shown.',
          },
          {
            title: 'Secure the account',
            text: 'On the account page you can add two-factor sign-in and change your password.',
          },
        ],
      },
      {
        id: 'library',
        title: 'Library',
        intro: 'Your books, with your reading position on every device.',
        steps: [
          {
            title: 'Import and read',
            text: 'Drag EPUB, PDF, MOBI, FB2 or comic archives into the library. Open a book to read, highlight and take notes.',
          },
          {
            title: 'Sync between devices',
            text: 'Reading progress, notes and books follow you across devices. "Data sync" in the advanced settings lets you switch categories on or off.',
          },
          {
            title: 'Lend a book',
            text: 'Share a single book with another user for 1, 7 or 30 days. It leaves their library when the time is up, or when you revoke it. Books lent to you appear under "Shared with me". Lists show the other person by name and username; an e-mail address appears only for someone who has not chosen a username yet.',
          },
          {
            title: 'Browse and borrow from people you follow',
            text: 'Switch on "People who follow me can browse my library" in your profile (off by default). Followers then see title, author and cover under "Explore" in the menu, never your reading progress or notes. In a book\'s share dialog you can hide single books. A follower can ask to borrow a book; under "People" you lend it for 1, 7 or 30 days or decline. A lent book works like any other loan: it leaves their library when the time is up. You get an e-mail when someone asks and when your request is answered; switch it off in your profile. Follow requests and books you share directly by e-mail address send no mail. It is a loan between people who know each other, not copy protection: respect the rights of the authors.',
          },
          {
            title: 'Storage',
            text: 'The account page shows how much space your files use and lets you remove files. In the cloud the files are kept under internal numbers; the list shows the title of each book, and the search finds books by title or author. "Shrink covers" on the same page scales large covers down (often from 1 to 2 MB to about 100 KB), on this device and in the cloud.',
          },
          {
            title: 'Back up your library',
            text: '"Backup & Restore" under "Advanced settings" saves your library as one ZIP file. It holds: the library list (titles, authors, series, tags, reading progress), your settings, the reading statistics, and for every book its file and cover. Notes, highlights, bookmarks and the reading position come along too: from this device, and for books that are only in the cloud from the server. Books marked with a cloud symbol are included and downloaded one by one for the backup (switch it off in the window to save only what is on this device). Not included: books lent to you, deleted books and account sign-in data (unless you tick the box for credentials). In Chrome the file is written straight to disk, so even a large library works; other browsers, Brave included, build it in memory (in Brave you can switch the setting "File System Access API" on under brave://flags). Restoring merges the backup with your current library and keeps the further reading position and every note. Inside the ZIP each book sits in a folder named by its internal ID, and the file is named after its current title.',
          },
          {
            title: 'Save selected books as ZIP',
            text: 'To take only some books out, for example to keep them on a NAS: tick the books (a group or series counts as all its books) and choose "Save as ZIP" in the bar at the bottom. You pick where to save the file. The ZIP holds only the book files, all in one folder level, each named after its current title (a title that appears twice gets " (2)"). Titles you changed in Cognoscimus are the names you get. There are no covers, reading positions or notes in it, and it is not a backup you can restore. Books that are only in the cloud are downloaded for it one by one. Books lent to you are left out, and a book whose file cannot be fetched is skipped and named when it is done. While it runs, a progress bar at the bottom of the screen shows which book is being saved. The saving goes on if you switch to Later or open a book, and you can cancel it there; closing or reloading the app stops it. A big selection can take a while, a book is only counted once it is fully loaded. In Chrome the file is written straight to disk, so a large selection works; other browsers, Brave included, build it in memory and show the save dialog only at the end, so keep the selection small there (in Brave you can switch the setting "File System Access API" on under brave://flags).',
          },
        ],
      },
      {
        id: 'later-save',
        title: 'Later: saving and reading',
        intro: 'Save links to read later, as clean text without ads.',
        steps: [
          {
            title: 'Save a link',
            text: 'Paste an address into the field at the top and press "Save". The settings (gear icon at the top right) hold a bookmarklet: drag it to your bookmarks bar and click it on any page. There is also a browser extension for Chrome and Firefox: its button saves the page as you see it, including pages behind a login, and lets you add a note, a collection and labels. Connect it once from its options. On a phone, install the app from the browser menu and use Share.',
          },
          {
            title: 'Articles, links, videos, documents',
            text: 'Pages with readable text become articles. Shops, repositories and pages with little text become links, video sites become videos and files such as PDFs become documents. You can filter by type. If the type is wrong, change it in the reader: "Save as article" on a link fetches the page again and keeps its text; the chain icon at the top of an article turns it into a link and removes the stored text and its highlights. Mails and documents keep their type.',
          },
          {
            title: 'Read, highlight, add notes',
            text: 'Open an item to read it. Select text to highlight it and add a note. Your reading position is kept. A short note on the item itself is possible too.',
          },
          {
            title: 'Archive and trash',
            text: 'New items land in the inbox. Archive what you are done with. Deleted items stay in the trash for 30 days before they are removed for good.',
          },
        ],
      },
      {
        id: 'later-organise',
        title: 'Later: organising',
        steps: [
          {
            title: 'Collections',
            text: 'Collections can be nested. Use the plus next to "Collections" to create one, and the menu on a collection to rename, move, share or delete it. Deleting a collection keeps its articles.',
          },
          {
            title: 'Labels',
            text: 'Add several labels to an item and click a label in the sidebar to see everything with it. Use "No label" to find items you have not sorted yet.',
          },
          {
            title: 'Search, sorting, saved views',
            text: 'The search covers titles and the full text. Sort by date, title or reading time, and use "Save this view" to keep a filter in the sidebar.',
          },
          {
            title: 'Several at once',
            text: '"Select" shows checkboxes and a bar at the bottom: archive, move, label or delete many items in one go.',
          },
          {
            title: 'Moving from Raindrop',
            text: 'In the settings (gear icon at the top right) you can import a Raindrop export. Its folders become collections, labels or are ignored, as you choose.',
          },
        ],
      },
      {
        id: 'later-people',
        title: 'Later: people and sharing',
        intro: 'Everything is private until you decide to share it.',
        steps: [
          {
            title: 'Follow someone',
            text: 'One follow list serves the library and Later. Under "People" enter the exact username. The other person has to accept your request, and only if their profile is set to discoverable can they be found at all.',
          },
          {
            title: 'Share with followers',
            text: 'In the reader, change the visibility of an item to "followers", or share a whole collection (sub-collections included) from its menu. Your labels stay private.',
          },
          {
            title: 'Explore',
            text: '"Explore" lists what the people you follow have shared, with type, source and note. Open an entry to read it, then save it to your own library or open the source.',
          },
          {
            title: 'Send an article',
            text: 'In the reader, send an item to a username. It is only an offer: the recipient finds it under "People" in "Sent to you", opens it, and then saves or deletes it.',
          },
          {
            title: 'Notes',
            text: 'A note on an item is shown to followers and recipients as well, unless you switch that off on the item.',
          },
        ],
      },
      {
        id: 'later-feeds',
        title: 'Later: feeds',
        steps: [
          {
            title: 'Subscribe',
            text: 'Under "Feeds" paste the address of a feed or of a website; the feed is found automatically. An OPML file imports many at once.',
          },
          {
            title: 'Choose what to keep',
            text: 'New entries appear in the feed stream and are not in your inbox. "Save" turns an entry into a normal article, "Dismiss" removes it. Entries you have not answered are removed after about 30 days.',
          },
          {
            title: 'Pause or remove',
            text: 'A feed that keeps failing is paused automatically. Under "Manage feeds" you can pause, resume or remove any feed.',
          },
        ],
      },
      {
        id: 'later-mail',
        title: 'Later: save by e-mail',
        steps: [
          {
            title: 'Your inbox address',
            text: 'Mail a link to {address} and it lands in your Later library. The address is also on the account page.',
          },
          {
            title: 'Links and longer mails',
            text: 'A short mail with a link saves that page, and any words around the link become a note. A longer mail, such as a newsletter, is saved as an article with the sender as its source.',
          },
          {
            title: 'Offer it to someone',
            text: 'Write @username alone on a line in a short mail to offer the item to that person. It is an offer like any sent article.',
          },
          {
            title: 'Which sender counts',
            text: 'Mail counts as yours when it comes from your sign-in address or from an extra address you added on the account page, and the sending domain vouches for it. Anything else is turned away.',
          },
        ],
      },
    ],
  },
  de: {
    title: 'Benutzerhandbuch',
    lead: 'Cognoscimus hat zwei Teile: die Bibliothek für deine Bücher und Later für das, was du im Web findest. Beide teilen ein Konto, eine Anmeldung und einen Benutzernamen.',
    toc: 'Inhalt',
    back: 'Zurück zu Cognoscimus',
    languageLabel: 'Sprache',
    sections: [
      {
        id: 'start',
        title: 'Erste Schritte',
        steps: [
          {
            title: 'Anmelden',
            text: 'Der Zugang ist nur auf Einladung möglich. Nach der Anmeldung landest du in der Bibliothek. Die Schaltflächen «Bibliothek» und «Later» oben wechseln zwischen den beiden Teilen.',
          },
          {
            title: 'Benutzernamen wählen',
            text: 'Öffne die Konto-Seite (das Personen-Symbol oder «Konto» im Menü) und wähle einen Benutzernamen. Er gilt für Bibliothek und Later und ist der einzige Name, den andere sehen: Deine E-Mail-Adresse wird nie gezeigt.',
          },
          {
            title: 'Konto absichern',
            text: 'Auf der Konto-Seite kannst du eine Zwei-Faktor-Anmeldung einrichten und das Passwort ändern.',
          },
        ],
      },
      {
        id: 'library',
        title: 'Bibliothek',
        intro: 'Deine Bücher, mit deiner Leseposition auf jedem Gerät.',
        steps: [
          {
            title: 'Importieren und lesen',
            text: 'EPUB, PDF, MOBI, FB2 oder Comic-Archive in die Bibliothek ziehen. Ein Buch öffnen, um zu lesen, zu markieren und Notizen zu machen.',
          },
          {
            title: 'Zwischen Geräten abgleichen',
            text: 'Lesefortschritt, Notizen und Bücher folgen dir auf alle Geräte. Unter «Datensynchronisierung» in den erweiterten Einstellungen schaltest du Kategorien ein oder aus.',
          },
          {
            title: 'Ein Buch ausleihen',
            text: 'Ein einzelnes Buch für 1, 7 oder 30 Tage mit einem anderen Nutzer teilen. Es verschwindet aus dessen Bibliothek, wenn die Zeit abläuft oder du den Zugriff widerrufst. Bücher, die dir geliehen wurden, findest du unter «Mit mir geteilt». In den Listen siehst du die andere Person mit Name und Benutzername; eine E-Mail-Adresse erscheint nur bei jemandem, der noch keinen Benutzernamen gewählt hat.',
          },
          {
            title: 'Bei gefolgten Personen stöbern und ausleihen',
            text: 'Schalte im Profil «Personen, die mir folgen, dürfen meine Bibliothek durchstöbern» ein (standardmässig aus). Follower sehen dann unter «Entdecken» im Menü Titel, Autor und Cover, nie deinen Lesefortschritt oder deine Notizen. Im Teilen-Dialog eines Buchs kannst du einzelne Bücher verbergen. Ein Follower kann ein Buch zum Ausleihen anfragen; unter «Personen» verleihst du es für 1, 7 oder 30 Tage oder lehnst ab. Ein verliehenes Buch funktioniert wie jede Leihgabe: Es verschwindet aus der Bibliothek der Person, wenn die Zeit abläuft. Bei einer Anfrage und bei der Antwort auf deine Anfrage bekommst du eine E-Mail; im Profil lässt sie sich ausschalten. Follow-Anfragen und Bücher, die du direkt per E-Mail-Adresse teilst, lösen keine Mail aus. Es ist eine Leihe zwischen Personen, die sich kennen, kein Kopierschutz: Achte die Rechte der Autorinnen und Autoren.',
          },
          {
            title: 'Speicher',
            text: 'Die Konto-Seite zeigt, wie viel Platz deine Dateien belegen, und lässt dich Dateien entfernen. In der Cloud liegen die Dateien unter internen Nummern; die Liste zeigt den Titel jedes Buchs, und die Suche findet Bücher nach Titel oder Autor. «Cover verkleinern» auf derselben Seite verkleinert grosse Cover (oft von 1 bis 2 MB auf etwa 100 KB), auf diesem Gerät und in der Cloud.',
          },
          {
            title: 'Bibliothek sichern',
            text: '«Sichern & Wiederherstellen» unter «Erweiterte Einstellungen» speichert deine Bibliothek als eine ZIP-Datei. Darin stecken: die Bibliotheksliste (Titel, Autoren, Reihen, Tags, Lesefortschritt), deine Einstellungen, die Lesestatistik und von jedem Buch die Datei und das Cover. Auch Notizen, Markierungen, Lesezeichen und die Leseposition kommen mit: von diesem Gerät, bei Büchern, die nur in der Cloud liegen, vom Server. Bücher mit einem Wolken-Symbol werden mitgesichert und dafür einzeln heruntergeladen (im Fenster lässt sich das ausschalten, dann kommt nur, was auf diesem Gerät liegt). Nicht enthalten: dir geliehene Bücher, gelöschte Bücher und Anmeldedaten des Kontos (ausser du setzt das Häkchen bei den Zugangsdaten). In Chrome wird die Datei direkt auf die Platte geschrieben, so funktioniert auch eine grosse Bibliothek; andere Browser, auch Brave, bauen sie im Arbeitsspeicher auf (in Brave lässt sich die Einstellung «File System Access API» unter brave://flags einschalten). Beim Wiederherstellen wird die Sicherung mit der aktuellen Bibliothek zusammengeführt; die weitere Leseposition und alle Notizen bleiben erhalten. Im ZIP liegt jedes Buch in einem Ordner mit seiner internen ID, die Datei heisst nach dem aktuellen Titel.',
          },
          {
            title: 'Ausgewählte Bücher als ZIP speichern',
            text: 'Wenn du nur einzelne Bücher herausnehmen willst, zum Beispiel für das NAS: Wähle die Bücher aus (eine Gruppe oder Reihe zählt als alle ihre Bücher) und tippe unten in der Leiste auf «Als ZIP laden». Du wählst, wo die Datei gespeichert wird. Im ZIP liegen nur die Buchdateien, alle auf einer Ebene und benannt nach dem aktuellen Titel (kommt ein Titel doppelt vor, wird « (2)» angehängt). Titel, die du in Cognoscimus geändert hast, sind also die Dateinamen. Cover, Leseposition und Notizen sind nicht dabei, und es ist keine Sicherung, die sich wiederherstellen lässt. Bücher, die nur in der Cloud liegen, werden dafür einzeln heruntergeladen. Dir geliehene Bücher fehlen, und ein Buch, dessen Datei sich nicht holen lässt, wird übersprungen und am Ende genannt. Solange es läuft, zeigt eine Fortschrittsleiste unten am Bildschirm, welches Buch gerade gespeichert wird. Das Speichern läuft weiter, wenn du zu Later wechselst oder ein Buch öffnest, und lässt sich dort abbrechen; App schliessen oder neu laden beendet es. Eine grosse Auswahl kann dauern, ein Buch zählt erst, wenn es vollständig geladen ist. In Chrome wird die Datei direkt auf die Platte geschrieben, so funktioniert auch eine grosse Auswahl; andere Browser, auch Brave, bauen sie im Arbeitsspeicher auf und zeigen den Speichern-Dialog erst am Ende, dort die Auswahl klein halten (in Brave lässt sich die Einstellung «File System Access API» unter brave://flags einschalten).',
          },
        ],
      },
      {
        id: 'later-save',
        title: 'Later: speichern und lesen',
        intro: 'Links zum späteren Lesen speichern, als sauberer Text ohne Werbung.',
        steps: [
          {
            title: 'Einen Link speichern',
            text: 'Eine Adresse oben ins Feld einfügen und «Speichern» drücken. In den Einstellungen (Zahnrad oben rechts) findest du ein Bookmarklet: in die Lesezeichenleiste ziehen und auf einer beliebigen Seite anklicken. Es gibt auch eine Browser-Erweiterung für Chrome und Firefox: Ihr Knopf speichert die Seite so, wie du sie siehst, auch hinter einem Login, und du kannst Notiz, Sammlung und Tags ergänzen. Verbinde sie einmal in ihren Optionen. Auf dem Handy die App über das Browsermenü installieren und «Teilen» nutzen.',
          },
          {
            title: 'Artikel, Links, Videos, Dokumente',
            text: 'Seiten mit lesbarem Text werden Artikel. Shops, Repositories und Seiten mit wenig Text werden Links, Videoseiten werden Videos und Dateien wie PDFs werden Dokumente. Du kannst nach Art filtern. Stimmt die Art nicht, änderst du sie im Reader: «Als Artikel speichern» bei einem Link holt die Seite erneut und behält ihren Text; das Ketten-Symbol oben bei einem Artikel macht daraus einen Link und entfernt den gespeicherten Text samt Markierungen. Mails und Dokumente behalten ihre Art.',
          },
          {
            title: 'Lesen, markieren, Notizen',
            text: 'Einen Eintrag öffnen, um ihn zu lesen. Text auswählen, um ihn zu markieren und eine Notiz anzufügen. Deine Leseposition bleibt erhalten. Auch eine kurze Notiz zum Eintrag selbst ist möglich.',
          },
          {
            title: 'Archiv und Papierkorb',
            text: 'Neue Einträge landen im «Eingang». Was erledigt ist, kommt ins Archiv. Gelöschte Einträge bleiben 30 Tage im Papierkorb, bevor sie endgültig verschwinden.',
          },
        ],
      },
      {
        id: 'later-organise',
        title: 'Later: ordnen',
        steps: [
          {
            title: 'Sammlungen',
            text: 'Sammlungen lassen sich verschachteln. Mit dem Plus neben «Sammlungen» legst du eine an, im Menü einer Sammlung benennst du sie um, verschiebst, teilst oder löschst sie. Beim Löschen einer Sammlung bleiben ihre Artikel erhalten.',
          },
          {
            title: 'Labels',
            text: 'Einem Eintrag mehrere Labels geben und in der Seitenleiste ein Label anklicken, um alles damit zu sehen. Mit «Ohne Label» findest du, was du noch nicht sortiert hast.',
          },
          {
            title: 'Suche, Sortierung, gespeicherte Ansichten',
            text: 'Die Suche durchsucht Titel und Volltext. Nach Datum, Titel oder Lesezeit sortieren, und mit «Ansicht speichern» einen Filter in der Seitenleiste behalten.',
          },
          {
            title: 'Mehrere auf einmal',
            text: '«Auswählen» zeigt Kontrollkästchen und eine Leiste unten: viele Einträge auf einmal archivieren, verschieben, mit Labels versehen oder löschen.',
          },
          {
            title: 'Umzug von Raindrop',
            text: 'In den Einstellungen (Zahnrad oben rechts) kannst du einen Raindrop-Export importieren. Seine Ordner werden Sammlungen, Labels oder werden ignoriert, wie du es wählst.',
          },
        ],
      },
      {
        id: 'later-people',
        title: 'Later: Personen und Teilen',
        intro: 'Alles bleibt privat, bis du es teilen willst.',
        steps: [
          {
            title: 'Jemandem folgen',
            text: 'Eine Follower-Liste gilt für Bibliothek und Later. Unter «Personen» den genauen Benutzernamen eingeben. Die andere Person muss deine Anfrage annehmen, und nur wenn ihr Profil auf «auffindbar» steht, kann sie überhaupt gefunden werden.',
          },
          {
            title: 'Mit Followern teilen',
            text: 'Im Reader die Sichtbarkeit eines Eintrags auf «Follower» stellen, oder eine ganze Sammlung (samt Untersammlungen) über ihr Menü teilen. Deine Labels bleiben privat.',
          },
          {
            title: 'Entdecken',
            text: '«Entdecken» zeigt, was die Personen, denen du folgst, geteilt haben, mit Art, Quelle und Notiz. Einen Eintrag öffnen, um ihn zu lesen, und dann in die eigene Bibliothek speichern oder die Quelle öffnen.',
          },
          {
            title: 'Einen Artikel senden',
            text: 'Im Reader einen Eintrag an einen Benutzernamen senden. Das ist nur ein Angebot: Die Person findet es unter «Personen» bei «An dich gesendet», öffnet es und speichert oder löscht es dann.',
          },
          {
            title: 'Notizen',
            text: 'Eine Notiz zu einem Eintrag sehen auch Follower und Empfänger, ausser du schaltest das beim Eintrag aus.',
          },
        ],
      },
      {
        id: 'later-feeds',
        title: 'Later: Feeds',
        steps: [
          {
            title: 'Abonnieren',
            text: 'Unter «Feeds» die Adresse eines Feeds oder einer Webseite einfügen; der Feed wird automatisch gefunden. Mit einer OPML-Datei importierst du viele auf einmal.',
          },
          {
            title: 'Auswählen, was bleibt',
            text: 'Neue Einträge erscheinen im Feed-Strom und nicht in deinem Eingang. «Speichern» macht aus einem Eintrag einen normalen Artikel, «Verwerfen» entfernt ihn. Einträge, die du nicht beantwortet hast, werden nach etwa 30 Tagen entfernt.',
          },
          {
            title: 'Pausieren oder entfernen',
            text: 'Ein Feed, der immer wieder fehlschlägt, wird automatisch pausiert. Unter «Feeds verwalten» kannst du jeden Feed pausieren, fortsetzen oder entfernen.',
          },
        ],
      },
      {
        id: 'later-mail',
        title: 'Later: per E-Mail speichern',
        steps: [
          {
            title: 'Deine Inbox-Adresse',
            text: 'Schick einen Link an {address}, und er landet in deiner Later-Bibliothek. Die Adresse steht auch auf der Konto-Seite.',
          },
          {
            title: 'Links und längere Mails',
            text: 'Eine kurze Mail mit einem Link speichert diese Seite, und Worte rund um den Link werden zur Notiz. Eine längere Mail, etwa ein Newsletter, wird als Artikel mit dem Absender als Quelle gespeichert.',
          },
          {
            title: 'Jemandem anbieten',
            text: 'Schreibe @benutzername allein auf eine Zeile einer kurzen Mail, um den Eintrag dieser Person anzubieten. Das ist ein Angebot wie bei jedem gesendeten Artikel.',
          },
          {
            title: 'Welcher Absender zählt',
            text: 'Eine Mail gilt als deine, wenn sie von deiner Anmeldeadresse oder von einer Zusatzadresse kommt, die du auf der Konto-Seite eingetragen hast, und die absendende Domain dafür bürgt. Alles andere wird abgewiesen.',
          },
        ],
      },
    ],
  },
};

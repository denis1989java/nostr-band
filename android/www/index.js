$(function () {

    const NOSTR_API = "https://api.nostr.band/nostr?";
    const PUBLIC_API = "https://api.nostr.band/v0";
    const RELAY = "wss://relay.nostr.band";
    const RELAY_ALL = "wss://relay.nostr.band/all";
    const EMBED_VERSION = "0.1.12";

    const KIND_META = 0;
    const KIND_CONTACT_LIST = 3;
    const KIND_DELETE = 5;
    const KIND_PEOPLE_LIST = 30000;
    const KIND_LABEL = 1985;

    const LABEL_CATEGORY = "ugc";

    const tools = window.NostrTools;

    let login_pubkey = localGet("login");

    let latest_contact_list = null;
    let latest_lists = null;
    let latest_labels = null;

    let relays = null;

    let serp = null;

    let embed = false;

    // global flag of an active scan
    let scanning_relays = false;

    // nostr extension
    let on_nostr_handlers = [];
    let nostr_enabled = false;

    async function addOnNostr(handler) {
        if (nostr_enabled)
            await handler();
        else
            on_nostr_handlers.push(handler);
    }

    function enableNostr() {

        return new Promise(function (ok) {

            // check window.nostr periodically, backoff exponentially,
            // and if we've detected window.nostr give it a bit more time
            // to init
            let period = 100;
            let has_nostr = false;
            async function checkNostr() {
                if (has_nostr) {

                    nostr_enabled = true;
                    for (const h of on_nostr_handlers)
                        await h();

                    ok ();
                } else {
                    // console.log("wait nostr", period, !!window.nostr);
                    if (window.nostr) {
                        has_nostr = true;
                        // wait until it initializes
                        setTimeout(checkNostr, 500);
                    } else {
                        period *= 2;
                        setTimeout(checkNostr, period);
                    }
                }
            }

            // start it
            checkNostr();
        });

    }

    // https://gist.github.com/kares/956897?permalink_comment_id=2341811#gistcomment-2341811
    function deParams(str) {
        return (str || document.location.search).replace(/(^\?)/,'')
            .split("&").map(function(n){return n = n.split("="),this[n[0]] = n[1],this}.bind({}))[0];
    }

  function formatPageUrl(q, p, type) {
    console.log(q, p, type);
    const eq = encodeURIComponent(q);
    const ep = encodeURIComponent(p ? p : "");
    const et = encodeURIComponent(type ? type : "");
    if (type === "nostr") {
      return `index.html?viewParam=${q}`;
    }
    if (type === "zaps") {
      return (
        "index.html?q=" +
        eq +
        (ep ? "&p=" + ep : "") +
        (et ? "&type=" + et : "")
      );
    }
    return (
      "index.html?q=" + eq + (ep ? "&p=" + ep : "") + (et ? "&type=" + et : "")
    );
  }

    async function copyToClip(data) {
        try
        {
            await navigator.clipboard.writeText(data);
            toastOk("OK", "Copied!");
        } catch (err) {
            toastError("Failed to copy to clipboard");
        }
    }

    function search(req) {
        return searchNostr(req);
    }

    function san(s) {
        if (!s)
            return "";

        // allow limited html tags as html-entities
        const tagsToReplace = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;'
        };
        s = s.replace(/[&<>]/g, function(tag) {
            return tagsToReplace[tag] || tag;
        });
        // crop everything else
        return window.DOMPurify.sanitize(s, { USE_PROFILES: { html: false } });
    }

    function getProfilePicture(p) {
        if (p && p.picture && !p.picture.includes(" "))
            return p.picture;
        else
            return "";
    }

    function formatThumbUrl(pubkey, type, big)
    {
        const size = big ? 192 : 64;
        return "https://media.nostr.band/thumbs/"
            + pubkey.substring(pubkey.length - 4) + "/"
            + pubkey + "-" + type + "-" + size;
    }

    function getNpub(pubkey)
    {
        return tools.nip19.npubEncode(pubkey);
    }

    function getNoteId(id)
    {
        return tools.nip19.noteEncode(id);
    }

    window.replaceImgSrc = function (img)
    {
        const src = getBranchAttr($(img), 'data-src');
        if ($(img).attr("src") != src)
            $(img).attr("src", src);
    }

    function getAuthorName(u)
    {
        return getProfileName(u.pubkey, u.author);

//	let author = u.pubkey?.substring(0, 8);
//	if (u.author?.name)
//	    author = u.author.name;
//	if (u.author?.display_name)
//	    author = u.author.display_name;
//	return author;
    }

    function formatScanRelays(q)
    {
        return `
<p class='mt-4'>Looking for a note or a pubkey? 
Let's scan all known relays right from your browser:<br>
<button class='mt-1 btn btn-outline-secondary' id='scan-relays' data-query='${q}'>Scan relays</button>
</p>
<p id='scan-relays-status'></p>
<p id='scan-relays-results'></p>
`;
    }

    function formatContent(e, max_size) {
        let c = san(e.content);

        // https://stackoverflow.com/questions/22962220/remove-multiple-line-breaks-n-in-javascript
        c = c.replace(/(\r\n|\r|\n){2,}/g, '$1\n');

        if (c.length > max_size)
            c = c.substring(0, max_size) + "...";

        e.links?.sort ((a, b) => b.text.length - a.text.length);

        const inlines = [];
        const intersects = (m) => {
            for (const n of inlines) {
                if (n.o >= m.o && n.o <= (m.o + m.l)
                    || (m.o >= n.o && m.o <= (n.o + n.l))) {
                    return true;
                }
            }
            return false;
        };

        for (const i in e.links) {
            const link = e.links[i];
            if (!link.text)
                continue;

            const san_text = link.text.replaceAll("&", "&amp;");
            const rx = san_text.replaceAll("[", "\\[").replaceAll("]", "\\]").replaceAll("?", "\\?");
            //	    console.log(san_text, rx);
            try
            {
                const matches = c.matchAll(new RegExp(rx, 'g'));
                for (const match of matches) {
                    //		    console.log("match", match);
                    const m = {i: i, o: match.index, l: san_text.length};
                    if (!intersects (m))
                        inlines.push (m);
                }
            }
            catch (e) {}
        }

        inlines.sort(function (a, b) {
            if (a.o < b.o)
                return -1;
            if (a.o > b.o)
                return 1;
            return 0;
        });
        //	console.log("inlines", inlines, e.links);

        let content = "";
        let gallery = "";
        let last_offset = 0;
        let last_inline_offset = -1;
        for (const m of inlines)
        {
            // duplicate tags etc
            if (m.o == last_inline_offset)
                continue;

            last_inline_offset = m.o;

            // append last segment
            const segment = c.substring (last_offset, m.o);
            //	    console.log(m, segment);
            content += segment;

      // append link
      const link = e.links[m.i];
      let href = link.uri;
      if (link.type == "pubkey") {
        href = `index.html?viewParam=${getNpub(link.uri)}`;
      } else if (link.type == "event")
        href = "index.html?viewParam=" + getNoteId(link.uri);
      else if (link.type == "hashtag")
        href =
          "index.html?q=" +
          encodeURIComponent((link.uri.startsWith("#") ? "" : "#") + link.uri);
      else if (link.type == "url") href = link.uri;
      const ext = link.type == "url";
      let label = link.label;
      if (link.type == "url") {
        label =
          link.uri.length > 40
            ? link.uri.substring(0, 30) +
              "..." +
              link.uri.substring(link.uri.length - 10)
            : link.uri;
      } else if (!label) {
        label = link.uri;
      }

            if (!link.label && link.type == "event")
            {
                const note = getNoteId(link.uri);
                label = note.substring (0, 10) + "..." + note.substring (note.length - 4, note.length);
            }
            if (link.type == "pubkey")
            {
                if (!link.label)
                {
                    const npub = getNpub(link.uri);
                    label = npub.substring (0, 10) + "..." + npub.substring (npub.length - 4, npub.length);
                }
                label = "@" + label;
            }

            content += `<a href='${href}' ${ext ? "target='_blank'" : ""}'>${label}</a>`;
            if (link.type == "url")
            {
                const u = link.uri.split('?')[0].toLowerCase();
                if (u.endsWith(".mov") || u.endsWith(".mp4"))
                {
                    content += `<div class='player'><button class='btn btn-sm btn-outline-secondary player-button'>Play</button><video class='play' style='display: none' src="${link.uri}" controls="" preload="metadata"></video></div> `;
                }
                else if (u.endsWith(".mp3") || u.endsWith(".ogg"))
                {
                    content += `<div class='player'><button class='btn btn-sm btn-outline-secondary player-button'>Play</button><audio class='play' style='display: none' src="${link.uri}" controls="" preload="metadata"></audio></div> `;
                }
                else if (u.includes("youtube.com/") || u.includes("youtu.be/"))
                {
                    let id = "";
                    if (u.includes("youtu.be/"))
                        id = link.uri.split('youtu.be/')[1].split('?')[0].split('/')[0];
                    else if (u.includes("youtube.com/"))
                        id = deParams(link.uri.split ('?')[1])['v'];
                    console.log(u, id, deParams(link.uri));

                    if (id)
                        content += `<div class='player'><button class='btn btn-sm btn-outline-secondary player-button'>Play</button>
<iframe id="ytplayer" class='play' style='display: none' type="text/html" width="640" height="360" src="https://www.youtube.com/embed/${id}?origin=https://nostr.band" frameborder="0"></iframe></div> `;
                }
                else if (u.endsWith(".webp") || u.endsWith(".jpg")
                    || u.endsWith(".jpeg") || u.endsWith(".gif") || u.endsWith(".png"))
                {
                    if (!gallery)
                    {
                        gallery = `
<div class='player'><button class='btn btn-sm btn-outline-secondary player-button'>Gallery</button>
<div class="play" style='${embed ? "" : "display: none"}'>
    <div class="container ps-0 pe-0">
        <div class="row gallery">
`;
                    }

                    gallery += `
<div class="col-sm-12 col-md-4 col-lg-3"><a href="${link.uri}" target='_blank' data-toggle="lightbox" data-gallery="${e.id}"><img class="img-fluid" src="${link.uri}"></a></div>
`;
                }
            }

            // advance
            last_offset = m.o + m.l;
        }
        // tail
        if (last_offset < c.length)
            content += c.substring (last_offset, c.length);

        content = content.replaceAll("\n", "<br>");

        if (gallery)
        {
            gallery += "</div></div></div></div>";
            content += gallery;
        }

        return content;
    }

    function formatZapAmount(n) {
        n /= 1000; // msat -> sat
        if (n >= 1000000)
            return (Math.round(n / 100000) / 10) + "M";
        if (n >= 1000)
            return (Math.round(n / 100) / 10) + "K";
        return n;
    }

    function formatEvent(req) {
        let u = req.e;
        if (!u.pubkey)
        {
            console.error("bad event ", req.e);
            return "";
        }

        let root = req.root;
        let options = req.options || '';

        if (root && !root.pubkey)
        {
            console.error("bad root ", root);
            return "";
        }

        const no_reply = true; // options.includes ("no_reply");
        const no_padding = options.includes ("no_padding");
        const thread_root = options.includes ("thread_root");
        const no_offset = options.includes ("no_offset");
        const main = options.includes ("main");

        const author = getAuthorName(u);

        const max_size = thread_root ? 10000 : 1000;
        let content = "";
        if (u.type == "long_post" && u.summary)
            content = `<p class='mt-1'><i>${san(u.summary)}</i></p>`;
        content += formatContent(u, max_size);

        const tm = (new Date((u.published_at ? u.published_at : u.created_at) * 1000)).toLocaleString();
        const img = getProfilePicture(u.author);
        const thumb = img ? formatThumbUrl(u.pubkey, "picture") : "";
        const psize = thread_root ? 48 : 32;

        const offset = (root || false) && !no_offset;

        const thread_url = formatPageUrl(u.id, 0, '', 'nostr');

    const npub = getNpub(u.pubkey);
    const url = new URL(window.location);
    // url.searchParams.set("viewParam", npub);
    pushUrl(url);
    const note = getNoteId(u.id);
    const post_href = "/" + getNoteId(u.id);
    const profile_href = url;
    // (u.type == "long_post" ? getNaddr(u) : getNoteId(u.id));
    const relay = "wss://relay.nostr.band";
    const nprofile = tools.nip19.nprofileEncode({
      pubkey: u.pubkey,
      relays: [relay],
    });
    const nevent = tools.nip19.neventEncode({ id: u.id, relays: [relay] });
    // FIXME need d_tag!!!
    //    const naddr = tools.nip19.naddrEncode({id: u.id, relays: [relay]});

        const profile_btns = `
<span class='profile-buttons'>
<!-- button type="button" class="btn btn-sm btn-light open-nostr-profile"><i class="bi bi-box-arrow-up-right"></i></button -->
<span class="profile-menu">
  <button class="btn btn-sm dropdown-toggle" type="button" data-bs-toggle="dropdown" aria-expanded="false"></button>
  <ul class="dropdown-menu">
    <li><button class="dropdown-item open-nostr-profile">Go to app...</button></li>
    <li><button class="dropdown-item copy-to-clip" data-copy='${npub}'>Copy npub</button></li>
    <li><button class="dropdown-item copy-to-clip" data-copy='${nprofile}'>Copy nprofile</button></li>
    <li><button class="dropdown-item copy-to-clip" data-copy='${u.pubkey}'>Copy HEX</button></li>
  </ul>
</span>
</span>
`;

        let relays = "";
        for (const r of u.relays)
            relays += (relays ? "," : "") + r;

        let btns = "";
        if (!req.show_post)
            btns += `
<span class='event-buttons'>
<span class="event-menu">
  <button class="btn btn-sm dropdown-toggle" type="button" data-bs-toggle="dropdown" aria-expanded="false"></button>
  <ul class="dropdown-menu">
    <li><button class="dropdown-item open-nostr-event">Go to app...</button></li>
    <li><button class="dropdown-item copy-to-clip" data-copy='${note}'>Copy note ID</button></li>
    <li><button class="dropdown-item copy-to-clip" data-copy='${nevent}'>Copy nevent</button></li>
    <li><button class="dropdown-item copy-to-clip" data-copy='${u.id}'>Copy HEX</button></li>
  </ul>
</span>
</span>
`;
        // ${no_reply ? '' : "<small><a href='#' class='nostr-reply'>reply</a></small>"}

        const upvotes = u.upvotes - u.downvotes;

        const style = thread_root ? " style='font-size: 1.5em'" : "";

        const title = u.title ? `
<a class="text-muted nostr-event-link" href='${post_href}'><h4 class='mt-2' ${style}>${san(u.title)}</h4></a>
` : "";

        let html = `
<div class='row nostr-serp-url' 
 data-eid='${san(u.id)}' 
 data-root='${san(root ? root.id : u.id)}' 
 data-relay='${u.relays[0]}' 
 data-root-relay='${root ? root?.relays[0] : "-1"}' 
 data-pubkey='${u.pubkey}'
 id='nostr-${san(u.id)}'
 ${style}
 >
<div class='col ${main ? "main" : ""}'><div class='card mb-3 no-border ${offset ? "ms-5" : ""}'>
<div class='card-body' style='padding-left: 0; ${no_padding ? "padding-top: 0; padding-bottom: 0" : ""}'>
<div class="card-subtitle text-muted" style="overflow:hidden;white-space:nowrap;"></div>
<div class='card-title mb-0' style='font-size: larger'>
<a class='nostr-profile-link' href='${profile_href}'>
<img style='width: ${psize}px; height: ${psize}px' 
 data-src='${san(img)}' src='${thumb}' 
 class="profile ${img ? '' : 'd-none'}" onerror="javascript:replaceImgSrc(this)"></a> 
<a class="nostr-profile-link" href='${profile_href}'>${san(author)}</a> ${profile_btns} 
</div>
<p class="card-text mb-0 ${req.show_post ? "" : "open-event-text"}">
${title}
${content}
</p>
<div class="card-text event-id">
`;
        if (!req.show_post)
        {
            html += `
<small class='text-muted'>
`;
            if (u.zap_amount)
                html += `
<span class='nostr-zaps me-2'><i class="bi bi-lightning"></i> ${formatZapAmount(u.zap_amount)}</span>
`;
            if (u.replies)
                html += `
<a href='${thread_url}' class='nostr-thread me-2'><i class="bi bi-chat"></i> ${u.replies}</a>
`;
            if (u.reposts)
                html += `
<span class='nostr-reposts me-2'><i class="bi bi-arrow-repeat"></i> ${u.reposts}</span>
`;
            if (u.upvotes)
                html += `
<span class='nostr-reactions me-2'><i class="bi bi-hand-thumbs-up"></i> ${upvotes}</span>
`;
            html += `
</small>
`;
        }
        html += `
<small><a class="text-muted nostr-event-link" href='${post_href}'>${tm}</a></small>
${btns}
</div>
`
        if (req.show_post)
        {
            html += `
<div style='font-size: smaller'>
`;
            if (u.zap_amount)
                html += `
<a href='/${note}/zaps' class="inline-link open-zaps-for me-3"><nobr><b>${formatZapAmount(u.zap_amount)}</b> sats</nobr></a>
`;

            if (upvotes)
                html += `
<span class="nostr-likes me-3"><b>${upvotes}</b> likes</span>
`;

            if (u.reposts)
                html += `
<span class="nostr-reposts me-3"><b>${u.reposts}</b> reposts</span>
`;

            if (u.relays.length)
                html += `
<span class="nostr-relays me-3 show-relays" data-relays="${relays}"><b>${u.relays.length}</b> relays</span>
`;

            html += `
</div>
`;

            if (embed)
            {
                html += `
<div><small class="text-muted" style='font-size: 12px'>Embed by <a target='_blank' href='https://nostr.band' style='color: rgb(33,37,41)'>Nostr.Band</a>.</small></div>
`;
            }

            html += `
<div class='mt-2 main-controls'>
<button type="button" class="btn btn-outline-secondary open-nostr-event me-1"><i class="bi bi-box-arrow-up-right"></i> Open</button>
`;

            html += `
<div class="btn-group event-labels">
  <button class="btn btn-outline-secondary dropdown-toggle label-button" type="button" data-bs-toggle="dropdown" aria-expanded="false">
    <i class="bi bi-tags"></i> <span class='label'>Label</span>
  </button>
  <ul class="dropdown-menu">
  </ul>
</div>
`;

            html += `
<div class="btn-group">
  <button class="btn btn-outline-secondary dropdown-toggle" type="button" data-bs-toggle="dropdown" aria-expanded="false">
    Menu
  </button>
  <ul class="dropdown-menu">
    <li><button class="dropdown-item open-nostr-event" data-select="true"><i class="bi bi-box-arrow-up-right"></i> Open with</button></li>
    <li><button class="dropdown-item share-nostr-event"><i class="bi bi-share"></i> Share</button></li>
    <li><button class="dropdown-item embed-nostr-event">
      <i class="bi bi-file-earmark-plus"></i> Embed</button></li>
    <li><hr class="dropdown-divider"></li>
    <li><button class="dropdown-item copy-to-clip" data-copy='${note}'>Copy note ID</button></li>
    <li><button class="dropdown-item copy-to-clip" data-copy='${nevent}'>Copy nevent</button></li>
    <li><button class="dropdown-item copy-to-clip" data-copy='${u.id}'>Copy id</button></li>
    <li><hr class="dropdown-divider"></li>
    <li><button class="dropdown-item show-relays" data-relays="${relays}">View relays</button></li>
    <li><button class="dropdown-item show-event-json" data-eid='${u.id}'>View JSON</button></li>
  </ul>
</div>
</div>
      `;


        }
        html += `
</div></div></div></div>
`;

        return html;
    }

    function getProfileName(pubkey, p) {
        let name = pubkey.substring(0, 8);
        if (p && p.name)
            name = p.name;
        if (p && p.display_name)
            name = p.display_name;
        return name;
    }

    function formatPerson(req) {
        let p = req.p;
        let new_followers_count = req.new_followers_count || 0;
        let show_profile = req.show_profile || false;
        let edits = req.edits || false;

        let name = p.pubkey.substring(0, 8);
        if (p.name)
            name = p.name;
        if (p.display_name)
            name = p.display_name;

        const first_tm = (new Date(p.first_tm * 1000)).toLocaleString();
        const last_tm = (new Date((edits ? p.last_tm : p.last_event_tm) * 1000)).toLocaleString();

        let handle = "";
        let nip05 = "";
        let nip05_url = "";
        if (p.nip05_verified)
        {
            const domain = p.nip05.includes("@") ? p.nip05.split("@")[1] : p.nip05;
            const name = p.nip05.includes("@") ? p.nip05.split("@")[0] : '';
            nip05 = `<i class="bi bi-check-circle" style='padding: 0 2px 0 2px'></i>` + domain;
            if (name && name != '_')
            {
                nip05 = name + nip05;
                nip05_url = "https://" + domain + "/.well-known/nostr.json?name=" + name;

                if (name != p.name && show_profile)
                    handle = p.name;
            }
            else
            {
                nip05_url = "https://" + domain + "/.well-known/nostr.json?name=_";
            }
        }

        const img = getProfilePicture(p);
        const thumb = formatThumbUrl(p.pubkey, "picture", /* big */show_profile || req.trending);

        let twitter = '';
        if (p.twitter && p.twitter.verified)
        {
            // <i class="bi bi-check-circle ${p.twitter.verified ? '' : 'd-none'}"></i>
            twitter = `
<small class='text-muted'>
<a class="twitter" href='https://twitter.com/${p.twitter.handle}' target='_blank'><nobr><i class="bi bi-twitter"></i>${p.twitter.handle}</nobr></a>
</small>
`;
        }

        const psize = show_profile ? 128 : (req.trending ? 90 : 54);
        const npub = getNpub(p.pubkey);
        const relay = "wss://relay.nostr.band";
        const nprofile = tools.nip19.nprofileEncode({pubkey: p.pubkey, relays: [relay]});
        const cl_naddr = tools.nip19.naddrEncode({pubkey: p.pubkey, kind: 3, relays: [relay], identifier: ""});
        const npub_short = npub.substring(0, 10) + "..." + npub.substring (59);
        const profile_href = "/" + npub;
        const website = p.website.startsWith ("https://") ? `
<small><a href='${p.website}' class='website-link' target='_blank'>${p.website}</a></small>
` : '';

        let relays = "";
        for (const r of p.relays)
            relays += (relays ? "," : "") + r;

        const nip = `
<small class='text-muted me-2 ${nip05 ? '' : 'd-none'}'>
<span><nobr>${nip05}</nobr></span> 
</small>
`;
        // <a class="nostr-profile-link" href='${profile_href}'><nobr>${nip05}</nobr></a>
        // <a class="nip05" href='${nip05_url}' target='_blank'>

        let btns = "";
        if (!show_profile)
            btns = `
<span class='profile-buttons'>
<span class="dropdown profile-menu">
  <button class="btn btn-sm dropdown-toggle" type="button" data-bs-toggle="dropdown" aria-expanded="false"></button>
  <ul class="dropdown-menu">
    <li><button class="dropdown-item open-nostr-profile">Go to app...</button></li>
    <li><button class="dropdown-item copy-to-clip" data-copy='${npub}'>Copy npub</button></li>
    <li><button class="dropdown-item copy-to-clip" data-copy='${nprofile}'>Copy nprofile</button></li>
    <li><button class="dropdown-item copy-to-clip" data-copy='${p.pubkey}'>Copy pubkey</button></li>
  </ul>
</span>
</span>
`;

        const keys = `
<small class='text-muted pubkey-npub' data-pubkey='${p.pubkey}'><nobr><i class="bi bi-key"></i> <span class='short'>${npub_short}</span><span class='long'>${npub_short}</span></nobr></small><br>
`;

        let zaps = "";
        if (p.zap_amount)
            zaps += `
<small><b>${formatZapAmount(p.zap_amount)}</b> sats received</small>
`;

        if (handle && show_profile)
            handle = `
<small class='text-muted'>@${handle}</small>
`;

        let ln = '';
        function formatLN(v, u)
        {
            if (!v) return;

            const lnurl = !v.includes ("@");
            const vs = !lnurl ? v : (v.substring(0, 10) + "..." + v.substring(v.length-4));

            if (lnurl && u && u.startsWith("https://"))
            {
                const dn = u.split("/.well-known/lnurlp/");
                if (dn.length == 2)
                    u = dn[1] + "@" + dn[0].substring (8);
            }

            let btn = "";
            if (lnurl)
                btn = `
<button class="btn btn-sm btn-outline-secondary copy-to-clip" style='padding: 1px' data-copy="${v}"><i class="bi bi-clipboard"></i></button>
`;

            ln += `
<small class='text-muted ln-address'>🗲 ${vs} ${btn} ${u ? "(" + u + ")" : ""}</small><br>
`;
        }

        formatLN(p.lud16, p.lud16_url);
        formatLN(p.lud06, p.lud06_url);

        //	if (p.lud16 && p.lud16.includes ("@")) // FIXME also lud06
        //	    ln = `
        //<small class='text-muted ln-address' data-ln-address='${p.pubkey}'>🗲 ${p.lud16}</small>
        //`;

        let rank = "";
        //	if (req.rank)
        //	    rank = `
        //<div class='col-auto pt-2' style='font-size: 1.5em'>${req.rank}.</div>
        //`;

        let html = `
<div class='row nostr-profile main' 
 data-pubkey='${san(p.pubkey)}' 
 data-relay='${p.relays[0]}' 
 id='nostr-${san(p.pubkey)}'
 ${show_profile ? 'style="font-size: 1.3em"' : ""}
>
${rank}
<div class='col'><div class='card mb-1 no-border'>
<div class='card-body' style='padding-left: 0'>
<div class="card-subtitle text-muted" style="overflow:hidden;white-space:nowrap;"><small></small></div>
<div class='card-title mb-0'>
<div class="row gx-2"><div class='col-auto'>
<a class='${show_profile ? '' : 'nostr-profile-link'}' href='${show_profile ? img : profile_href}'
  ${show_profile ? 'target="_blank"' : ''}>
<img style='width: ${psize}px; height: ${psize}px' 
 data-src='${san(img)}' src='${thumb}' onerror="javascript:replaceImgSrc(this)"
class="profile ${img ? '' : 'd-none'}"></a>
</div>
<div class='col'><a class="nostr-profile-link me-1"  href='${profile_href}'>${san(name)}</a>
${show_profile || req.trending ? btns + "<br>" : ""}
<span class="${show_profile ? "" : "open-profile-text"}">
${handle}
${nip}
${twitter}${show_profile && twitter ? "<br>" : ""}
${show_profile || req.trending ? keys : ""}
${show_profile ? ln : ""}
${show_profile ? website : ""}
${req.trending ? zaps : ""}
</span>
${show_profile || req.trending ? "" : btns}
<span class="${show_profile ? "" : "open-profile-text"}">
${show_profile || req.trending ? "" : "<br>" + zaps}
</span>
</div></div>
</div>
<p class="card-text mt-1 mb-1 ${show_profile ? "" : "open-profile-text"}">${san(p.about)}</p>
`
        //  + "<small class='text-muted profile-pubkey'>"+p.pubkey+"</small>"

        if (edits)
        {
            html += `
<div class="card-text event-id" style='padding: 0; line-height: 17px'>
<small class="text-muted"><span class='me-2'><nobr>Written: ${last_tm}</nobr></span></small>
</div>
`;
        }
        else
        {
            //${show_profile || req.trending ? "" : '<button type="button" class="btn btn-outline-secondary btn-sm me-2 follow-button"><span class="label">Follow</span></button>'}

            html += `
<div>
<span class="${show_profile ? "following" : "open-profile-text"} me-2"><b>${p.following_count}</b> Following</span>
<span class="${show_profile ? "followed" : "open-profile-text"} me-2"><b>${p.followed_count}</b> Followers${new_followers_count ? " <sup><b>+"+new_followers_count+"</b></sup>" : ""}</span>
`;
            if (show_profile)
            {
                html += "<br>";
                if (p.zap_amount)
                    html += `
<a href='/${npub}/zaps-received' class="inline-link open-zaps-to me-2"><nobr><b>${formatZapAmount(p.zap_amount)}</b> sats received</nobr></a>
`;
                if (p.zap_amount_sent)
                    html += `
<a href='/${npub}/zaps-sent' class="inline-link open-zaps-by me-2"><nobr><b>${formatZapAmount(p.zap_amount_sent)}</b> sats sent</nobr></a>
`;
                if (p.zap_amount_processed)
                    html += `
<a href='/${npub}/zaps-processed' class="inline-link open-zaps-via me-2"><nobr><b>${formatZapAmount(p.zap_amount_processed)}</b> sats processed</nobr></a>
`;

            }
            html += `
</div>
`;
            if (!req.trending)
            {
                html += `
<div class="card-text event-id">
<small class="text-muted">`;
                if (show_profile)
                    html += `
<span class='me-2'><nobr>Last active: ${last_tm}</nobr></span> 
`;
                html += `
<nobr>Created: ${first_tm}</nobr></small>
</div>
`;
            }

            if (embed)
            {
                html += `
<div><small class="text-muted" style='font-size: 12px'>Embed by <a target='_blank' href='https://nostr.band' style='color: rgb(33,37,41)'>Nostr.Band</a>.</small></div>
`;
            }

            // if (show_profile || req.trending)
            {
                const bsize = req.trending ? "btn-sm" : "";
                html += `
<div class="mt-2 main-controls">
`;
                if (!show_profile || req.trending)
                    html += `
<button type="button" class="btn ${bsize} btn-outline-secondary open-profile-text"><i class="bi bi-zoom-in"></i> View</button>
`;

                html += `
<button type="button" class="btn ${bsize} btn-outline-secondary open-nostr-profile"><i class="bi bi-box-arrow-up-right"></i> Open</button>
<button type="button" class="btn ${bsize} btn-outline-secondary follow-button"><i class="bi bi-person-plus"></i> <span class='label'>Follow</span></button>
`;

                html += `
<div class="btn-group user-lists">
  <button class="btn ${bsize} btn-outline-secondary dropdown-toggle list-button" type="button" data-bs-toggle="dropdown" aria-expanded="false">
    <i class="bi bi-bookmark-plus"></i> <span class='label'>List</span>
  </button>
  <ul class="dropdown-menu">
  </ul>
</div>
`;

                if (show_profile)
                {
                    html += `
<div class="btn-group">
  <button class="btn ${bsize} btn-outline-secondary dropdown-toggle" type="button" data-bs-toggle="dropdown" aria-expanded="false">
    Menu
  </button>
  <ul class="dropdown-menu">
    <li><button class="dropdown-item open-nostr-profile" data-select="true"><i class="bi bi-box-arrow-up-right"></i> Open with</button></li>
    <li><button class="dropdown-item share-nostr-profile"><i class="bi bi-share"></i> Share</button></li>
    <li><button class="dropdown-item embed-nostr-profile">
      <i class="bi bi-file-earmark-plus"></i> Embed</button></li>
    <li><hr class="dropdown-divider"></li>
    <li><button class="dropdown-item copy-to-clip" data-copy='${npub}'>Copy npub</button></li>
    <li><button class="dropdown-item copy-to-clip" data-copy='${nprofile}'>Copy nprofile</button></li>
    <li><button class="dropdown-item copy-to-clip" data-copy='${p.pubkey}'>Copy pubkey</button></li>
    <li><button class="dropdown-item copy-to-clip" data-copy='${cl_naddr}'>Copy contact list naddr</button></li>
    <li><hr class="dropdown-divider"></li>
    <li><button class="dropdown-item show-feed" data-pubkey="${p.pubkey}">View home feed</button></li>
    <li><a class="dropdown-item" href="${profile_href}/edits">View edit history</a></li>
    <li><button class="dropdown-item show-relays" data-relays="${relays}">View relays</button></li>
    <li><button class="dropdown-item show-profile-json" data-eid='${p.pubkey}'>View profile JSON</button></li>
    <li><button class="dropdown-item show-contacts-json" data-pubkey='${p.pubkey}'>View contacts JSON</button></li>
  </ul>
</div>`;

                    //	  html += `
                    //<button type="button" class="btn ${bsize} btn-outline-secondary share-nostr-profile"><i class="bi bi-share"></i> Share</button>
                    //<button type="button" class="btn ${bsize} btn-outline-secondary embed-nostr-profile"><i class="bi bi-file-earmark-plus"></i> Embed</button>
                    //</div>
                    //`
                }

                html += "</div>";
            }
        }

        html += `
</div></div></div></div>
`;
        if (edits)
            html += "<hr>";

        return html;
    }

    function formatZap(z, type)
    {
        const zap_tm = (new Date(z.created_at * 1000)).toLocaleString();

        const zapper_pubkey = z.desc.pubkey;
        const zapper_profile = z.zapper;
        const zapper_name = getProfileName(zapper_pubkey, zapper_profile);
        const zapper_href = "/" + getNpub(zapper_pubkey);
        const zapper_img = zapper_profile ? getProfilePicture(zapper_profile) : "";
        const zapper_thumb = zapper_img ? formatThumbUrl(zapper_pubkey, "picture") : "";
        const zapper_psize = 48;
        const zapper_comment = z.desc.content ? `Comment "<em>${san(z.desc.content)}</em>"` : "";

        const provider_pubkey = z.pubkey;
        const provider_profile = z.provider;
        const provider_name = getProfileName(provider_pubkey, provider_profile);
        const provider_href = "/" + getNpub(provider_pubkey);
        const provider_img = provider_profile ? getProfilePicture(provider_profile) : "";
        const provider_thumb = provider_img ? formatThumbUrl(provider_pubkey, "picture") : "";
        const provider_psize = 24;

        const target_pubkey = z.target_pubkey;
        const target_profile = z.target_profile;
        const target_name = getProfileName(target_pubkey, target_profile);
        const target_href = "/" + getNpub(target_pubkey);
        const target_img = target_profile ? getProfilePicture(target_profile) : "";
        const target_thumb = target_img ? formatThumbUrl(target_pubkey, "picture") : "";
        const target_psize = 48;

    let target = "to profile.";
    if (z.target_event) {
      const post_href = "index.html?viewParam=" + getNoteId(z.target_event.id);
      target = `
for "<em>${san(
        z.target_event.content.substring(0, 90)
      )}...</em> <a href='${post_href}'>&rarr;</a>" 
`;
        }

        let html = `
<div class='row zap' 
 id='nostr-${san(z.id)}'
 style='font-size: 1.3em'
>
<div class='col'>
<div class='card mb-1 no-border'>
<div class='card-body' style='padding-left: 0'>
<div class='card-title mb-0'>
<div class="row gx-2 align-items-center">
<div class='col-auto'>
<a class='nostr-profile-link' href='${zapper_href}' data-pubkey='${zapper_pubkey}'>
<img style='width: ${zapper_psize}px; height: ${zapper_psize}px' 
 data-src='${san(zapper_img)}' src='${zapper_thumb}' onerror="javascript:replaceImgSrc(this)"
class="profile ${zapper_img ? '' : 'd-none'}"></a>
</div>
<div class='col'><a class="nostr-profile-link align-middle" href='${zapper_href}' data-pubkey='${zapper_pubkey}'>${san(zapper_name)}</a>
</div>

<div class='col-auto ps-5 pe-5'> <i class="bi bi-chevron-right"></i> <b>${z.bolt11.msats / 1000} ${z.bolt11.msats >= 1500 ? "sats" : "sat"}</b> <i class="bi bi-chevron-right"></i>
</div>

<div class='col-auto'>
<a class='nostr-profile-link' href='${target_href}' data-pubkey='${target_pubkey}'>
<img style='width: ${target_psize}px; height: ${target_psize}px' 
 data-src='${san(target_img)}' src='${target_thumb}' onerror="javascript:replaceImgSrc(this)"
class="profile ${target_img ? '' : 'd-none'}"></a>
</div>
<div class='col'><a class="nostr-profile-link me-1"  href='${target_href}' data-pubkey='${target_pubkey}'>${san(target_name)}</a>
</div>

</div>
</div>
<p class="card-text mt-1 mb-1">
Zapped ${target}<br>
${zapper_comment}
</p>
<div class="row gx-2">
<div class='col-auto'><small class='text-muted'>${zap_tm}</small></div>
<div class='col'>
<nobr>to <a class='nostr-profile-link' href='${provider_href}' data-pubkey='${provider_pubkey}'>
<img style='width: ${provider_psize}px; height: ${provider_psize}px' 
 data-src='${san(provider_img)}' src='${provider_thumb}' onerror="javascript:replaceImgSrc(this)"
class="profile ${provider_img ? '' : 'd-none'}"></a>
<a class="nostr-profile-link me-1" href='${provider_href}' data-pubkey='${provider_pubkey}'>${san(provider_name)}</a>
</nobr>
</div>
</div>
</div>
</div>
</div>
</div>
`;

        return html;
    }

    function formatProfileSerpButtons(pubkey) {
        const npub = getNpub(pubkey);
        btns = `
<span class='profile-feed-buttons'>
<span class="dropdown profile-feed-menu">
  <button class="btn btn-sm dropdown-toggle" type="button" data-bs-toggle="dropdown" aria-expanded="false"></button>
  <ul class="dropdown-menu">
    <li><a class="dropdown-item" href="/${npub}">Posts & mentions</a></li>
    <li><a class="dropdown-item open-zaps-to" href="/${npub}/zaps-received">Zaps received</a></li>
    <li><a class="dropdown-item open-zaps-by" href="/${npub}/zaps-sent">Zaps sent</a></li>
    <li><a class="dropdown-item open-zaps-via" href="/${npub}/zaps-processed">Zaps processed</a></li>
  </ul>
</span>
</span>
`;
        return btns;
    }

    function setRelays(rs) {
        relays = rs;
        relays["10000"] = "wss://relay.nostr.band";
    }

    function formatProfileSerpListButtons() {
        return `
<div class='mt-2 mb-3'>
<b>Group action: </b>
<button class='btn btn-outline-secondary' id='follow-all'>Follow...</button>
<button class='btn btn-outline-secondary' id='unfollow-all'>Unfollow...</button>
<button class='btn btn-outline-secondary' id='list-all'>List...</button>
<button class='btn btn-outline-secondary' id='unlist-all'>Unlist...</button>
</div>
`;
    }

    function searchNostr(req) {
        console.log("search", req);
        let q = req.q;
        let p = req.p || 0;
        let type = req.type || '';
        let sort = req.sort || '';
        let scope = req.scope || '';

        $("#search-spinner").removeClass("d-none");
        $("#sb-spinner").removeClass("d-none");

        document.title = "Results for '"+q+"' | Nostr.Band";

        const eq = encodeURIComponent(q);
        const ep = encodeURIComponent(p ? p : '');
        const es = (sort && sort != "recent") ? "tr" : "";
        const ef = (scope == "personal") ? localGet("scope-pubkey") : "";
        //	const for_pubkey = (scope == "personal") ? localGet("scope-pubkey") : "";
        let eo = "";
        if (sort.endsWith("-day"))
            eo = "period_1d";
        else if (sort.endsWith("-week"))
            eo = "period_7d";
        else if (sort.endsWith("-month"))
            eo = "period_30d";

        let object_type = type;
        if (type == "profiles")
            object_type = "people";

        const url = NOSTR_API + "method=search&count=10&q=" + eq
            + (ep ? "&p=" + ep : "")
            + (es ? "&sort=" + es : "")
            + (eo ? "&options=" + eo : "")
            + (type ? "&type=" + object_type : "")
            + (ef ? "&for=" + ef : "")
        ;

        $.ajax({
            url,
        }).fail((x, r, e) => {
            $("#search-spinner").addClass("d-none");
            $("#sb-spinner").addClass("d-none");

            toastError("Search failed: "+e);
        }).done (r => {

            // stop spinning
            $("#search-spinner").addClass("d-none");
            $("#sb-spinner").addClass("d-none");

            // unstick from the window-bottom
            $("footer").removeClass("fixed-bottom");

            console.log("results", r);

            setRelays(r.relays);

            function pageUrl(p, t) {
                return formatPageUrl(q, p, t ? t : type);
            }

            // header of search results
            let html = "";

            // people preview for mixed search type
            if (r.people && r.people.length)
            {
                html += `<h2>Profiles</h2>`;

                for (const p of r.people)
                    html += formatPerson({p});

                if ((r.people_count - r.people.length) > 0)
                {
                    const url = pageUrl(0, "profiles");
                    html += `
<div class='mb-5'><a href='${url}' class='nostr-people-link'>And ${r.people_count - r.people.length} more profiles &rarr;</a></div>
`;
                }
            }

            // nothing?
            if ((!r.serp || !r.serp.length) && (!r.people || !r.people.length))
            {
                html += "<p class='mt-4'>Nothing found :(<br>";

                if (!q.includes ("-filter:spam"))
                {
                    const url = formatPageUrl(q + " -filter:spam", 0, type);
                    html += `
<a class='mt-1 btn btn-outline-secondary' href='${url}'>Retry without spam filter</a>
`;
                }
                html += "</p>";

                if (q.startsWith("note1") || q.startsWith("npub1") || q.length == 64)
                    html += formatScanRelays(q);
            }

            serp = r.serp ? r.serp : [];

            html += '<div id="serp">';
            if (r.serp.length)
            {
                let label = "Results";
                switch (type) {
                    case "profiles": label = "Profiles"; break;
                    case "posts": label = "Posts"; break;
                    case "zaps": label = "Zaps"; break;
                    case "long_posts": label = "Long posts"; break;
                }

                html += `<h2>${label}</h2>`;

                //		  html += "<canvas id='timeline' style='max-height: 300px; height: 200px'></canvas>";

                if (type == "profiles")
                {
                    html += `
<div class='row'><div class='col text-muted'><small>
${p ? "Page "+(p+1)+" of " : "Found "} ${r.result_count} profiles. 
</small>
</div></div>
`;
                    html += formatProfileSerpListButtons();

                }
                else
                {
                    html += `
<div class='row'><div class='col text-muted'><small>
${p ? "Page "+(p+1)+" of about " : "About "} ${r.result_count} results. 
</small>
</div></div>
`;
                }

                // print results
                for (const u of r.serp)
                {
                    if (type == "profiles")
                    {
                        html += formatPerson({p: u});
                        continue;
                    }
                    else if (type == "zaps")
                    {
                        html += formatZap (u);
                        continue;
                    }
                    else if (type == "long_post")
                    {
                        html += formatEvent ({e: u});
                        continue;
                    }

                    if (u.root)
                        html += formatEvent({e: u.root});

                    if (u.reply_to)
                        html += formatEvent({e: u.reply_to, root: u.root});

                    const root = u.root || u.reply_to;

                    html += formatEvent({e: u, root});

                    if (u.children)
                    {
                        for (const c of u.children)
                        {
                            if (c.reply_to)
                                html += formatEvent({e: c.reply_to, root: root || u});

                            html += formatEvent({e: c, root: root || u});
                        }
                    }
                }
            }
            html += "</div>"; // #serp

            // pagination
            {
                html += `<nav aria-label="Page navigation" id='pages'><ul class="pagination">`;

                function formatPage(page, label) {
                    if (page == r.page)
                        html += `
<li class="page-item active" aria-current="page"><span class="page-link">${label}</span></li>
`;
                    else
                        html += `
<li class="page-item"><a class="page-link" data-page="${page}" href="${pageUrl(page)}">${label}</a></li>
`;
                }

                if (r.page > 0)
                    formatPage (0, "First");
                if (r.page > 0)
                    formatPage (r.page-1, "Previous");

                let from = Math.max (0, r.page - 3);
                let till = Math.min (r.page_count, r.page + 4);
                for (let i = from; i < till; i++)
                    formatPage (i, i+1);

                if (r.page < (r.page_count - 1))
                    formatPage (r.page + 1, "Next");
                if (r.page < (r.page_count - 1))
                    formatPage (r.page_count - 1, "Last");

                html += `</ul></nav>`;
            }

            // set results
            $("#results").html(html);
            $("#welcome").addClass("d-none");
            $("#loading").addClass("d-none");
            $("#freebies").addClass("d-none");

            /*      $("#results .follow-button").on("click", (e) => {
	if (login_pubkey && window.nostr)
	{
	  const pk = getBranchAttr($(e.target), 'data-pubkey');
	  const relay = getBranchAttr($(e.target), 'data-relay');
	  const following = getBranchAttr($(e.target), 'data-following');
	  ensureFollowing(pk, relay, following == "true", e.target);
	}
	else
	{
	  $("#login-modal").modal("show");
	  // openNostrProfile(e);
	}
      });
*/
            $("#pages a.page-link").on("click", (e) => {
                e.preventDefault();
                const p = parseInt($(e.target).attr("data-page"));
                startSearchScroll(q, p, type, sort);
                return false;
            });

            $("#results a.nostr-people-link").on("click", (e) => {
                e.preventDefault();
                startSearchScroll(q, p, 'profiles', sort);
                return false;
            });
            /*
      $("#results .following").on("click", (e) => {
	const pk = getBranchAttr($(e.target), 'data-pubkey');
	const q = "following:" + getNpub(pk);
	startSearchScroll(q, 0, 'profiles', '');
      });

      $("#results .show-feed").on("click", (e) => {
	const pk = getBranchAttr($(e.target), 'data-pubkey');
	const q = "following:" + getNpub(pk);
	startSearchScroll(q, 0, 'posts', '');
      });

      $("#results .followed").on("click", (e) => {
	const pk = getBranchAttr($(e.target), 'data-pubkey');
	showFollows(pk, true);
      });
*/
            attachSerpEventHandlers("#results");

            addOnNostr(updateNostrContactList);
            addOnNostr(updateNostrLists);

            // render right now in case window.nostr doesn't come
            updateNostrContactList();
            updateNostrLists();

            //	    if (r.timeline)
            //		showTimeline("#timeline", r.timeline,
            //			     {c: "Number of " + (type == "people" ? "profiles" : "posts")});
        });
    }

    function showTimeline(sel, timeline, fields) {

        const cfg = {
            type: 'bar', // 'line'
            data: {
                labels: timeline.map((v) => {
                    return v.d.split(' ')[0];
                }),
                datasets: []
            },
            options: {
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true
                    }
                }
            }
        };

        for (const i in fields)
        {
            cfg.data.datasets.push ({
                label: fields[i],
                data: timeline.map(v => v[i]),
                borderWidth: 1
            });
        }
        console.log(cfg);

        new Chart ($(sel), cfg);
    }

    function searchNostrEvent(e) {
        e.preventDefault();
        const eid = getBranchAttr($(e.target), 'data-eid');
        startSearchScroll(eid);
        return false;
    }

    function embedNostrObject(id) {

        const code = `
<div id="nostr-embed-${id}"></div>
<script>
  !(function () {
    const n=document.createElement('script');n.type='text/javascript';n.async=!0;n.src='https://cdn.jsdelivr.net/gh/nostrband/nostr-embed@${EMBED_VERSION}/dist/nostr-embed.js';
    n.onload=function () {
      nostrEmbed.init(
        '${id}',
        '#nostr-embed-${id}',
        '',
        {showZaps: true}
      );
    };const a=document.getElementsByTagName('script')[0];a.parentNode.insertBefore(n, a);
  })();
<` + `/script>`;
        $("#embed-code").val(code);
        $("#embed-link").attr("href", "https://embed.nostr.band/?q=" + id);
        $("#embed-url").val("https://nostr.band/" + id + "?embed");

        $("#embed-modal").modal("show");
    }

    function embedNostrEvent(e) {
        e.preventDefault();
        const eid = getBranchAttr($(e.target), 'data-eid');
        embedNostrObject(getNoteId(eid));
    }

    function embedNostrProfile(e) {
        e.preventDefault();
        const pubkey = getBranchAttr($(e.target), 'data-pubkey');
        embedNostrObject(getNpub(pubkey));
    }

    async function shareNostrEvent(e) {
        e.preventDefault();
        const eid = getBranchAttr($(e.target), 'data-eid');
        const url = "https://nostrapp.link/#" + getNoteId(eid);
        const data = {
            url
        };
        try
        {
            if (navigator.canShare && navigator.canShare(data))
            {
                await navigator.share(data);
            }
            else
            {
                await navigator.clipboard.writeText(url);
                toastOk("OK", "Link to post copied to clipboard!");
            }
        } catch (err) {
            console.log(err);
            toastError("Failed to copy to clipboard or share data");
        }
    }

    async function shareNostrProfile(e) {
        e.preventDefault();
        const pk = getBranchAttr($(e.target), 'data-pubkey');
        const url = "https://nostrapp.link/#" + getNpub(pk);
        const data = {
            url
        };
        try
        {
            if (navigator.canShare && navigator.canShare(data))
            {
                await navigator.share(data);
            }
            else
            {
                await navigator.clipboard.writeText(url);
                toastOk("OK", "Link to profile copied to clipboard!");
            }
        } catch (err) {
            console.log(err);
            toastError("Failed to copy to clipboard or share data");
        }
    }

    function openAppManager(id, select) {
        window.open("https://nostrapp.link/#" + id + (select ? "?select=true" : ""),'_blank');
    }

    function openNostrEvent(e) {
        e.preventDefault();
        const eid = getBranchAttr($(e.target), 'data-eid');
        const select = getBranchAttr($(e.target), 'data-select');
        openAppManager(getNoteId(eid), select);
        return false;
        //    $("#nostr-client-modal").attr("data-target", eid);
        //    $("#nostr-client-modal").attr("data-type", "event");
        //    $("#nostr-client-modal").attr("data-follows", false);
        //    $("#nostr-client-modal").modal("show");
        //    return false;
    }

    function openNostrProfile (e) {
        e.preventDefault();
        const pk = getBranchAttr($(e.target), 'data-pubkey');
        const select = getBranchAttr($(e.target), 'data-select');
        openAppManager(getNpub(pk), select);
        //    $("#nostr-client-modal").attr("data-target", pk);
        //    $("#nostr-client-modal").attr("data-type", "profile");
        //    $("#nostr-client-modal").attr("data-follows", false);
        //    $("#nostr-client-modal").modal("show");
        return false;
    }

    function setQuery(q) {
        scanning_relays = false;

        if (q)
            $("#advanced-bar").removeClass("d-none");
        else
            $("#advanced-bar").addClass("d-none");

        $(".a-s").val("");
        $("#q").val(q);
        $("#a-q").val(q);
        $("#a-and").val(q);
    }

    function startSearchScroll(q, p, type, sort) {
        setQuery(q);
        setType(type);
        pushSearchState (q, p, type, sort);
        scrollTop();
    }

    async function showFollows(pk, is_followers) {
        $("#search-spinner").removeClass("d-none");

        $("#follows-modal .modal-body").html('');
        $("#follows-modal .modal-title").html("Loading...");
        $("#follows-modal").modal("show");

        const ep = encodeURIComponent(pk);
        $.ajax({
            url: NOSTR_API + "method=profile&pubkey=" + ep,
        }).fail((x, r, e) => {
            $("#search-spinner").addClass("d-none");

            toastError("Request failed: "+e);
        }).done (r => {
            $("#search-spinner").addClass("d-none");

            console.log(r);

            const list = is_followers ? r.followed : r.following;
            let html = "";
            for (const p of list)
            {
                let name = p.pubkey.substring(0, 8);
                if (p.name)
                    name = p.name;

                const nip05 = p.nip05_verified ? p.nip05 : '';

                const img = getProfilePicture(p);
                const thumb = formatThumbUrl(p.pubkey, "picture");
                const psize = 32;

                html += `
<div class='nostr-follows-profile' 
 data-pubkey='${san(p.pubkey)}' 
 id='nostr-follows-${p.pubkey}'>
<div class='col'><div class='card mb-1 no-border'>
<div class='card-body' style='padding-left: 0; padding-bottom: 5px; padding-top: 5px'>
<div class='card-title mb-0' style='font-size: larger'>
<span class='open-nostr-profile'>
<img style='object-fit: contain; width: ${psize}px; height: ${psize}px' 
 data-src='${san(img)}' src="${thumb}" onerror="javascript:replaceImgSrc(this)"
class="profile ${img ? '' : 'd-none'}"> ${san(name)}</span>
<small class='text-muted ms-2'>${nip05 ? '<i class="bi bi-check-circle"></i>' : ''} ${nip05}</small>
</div>
<p class="card-text mb-0">${san(p.about)}</p>
<small class='text-muted profile-pubkey'>${p.pubkey}</small>
</div></div></div></div>
`;
            }

            $("#follows-modal .modal-body").html(html);
            let title = "";
            if (is_followers)
                title = "Followers " + r.followed_count;
            else
                title = "Following " + r.following_count;
            $("#follows-modal .modal-title").html(title);

            $("#follows-modal .open-nostr-profile").on("click", (e) => {
                const pk = getBranchAttr($(e.target), 'data-pubkey');
                $("#nostr-client-modal").attr("data-target", pk);
                $("#nostr-client-modal").attr("data-type", "profile");
                $("#nostr-client-modal").attr("data-follows", true);
                $("#follows-modal").modal("hide");
                $("#nostr-client-modal").modal("show");
                return false;
            });

            $("#follows-modal").modal("show");
        });
    }

    function sha256_hex(string) {
        const utf8 = new TextEncoder().encode(string);
        return crypto.subtle.digest('SHA-256', utf8).then((hashBuffer) => {
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            const hashHex = hashArray
                .map((bytes) => bytes.toString(16).padStart(2, '0'))
                .join('');
            return hashHex;
        });
    }

    async function getNostrEventID(m) {
        const a = [
            0,
            m.pubkey,
            m.created_at,
            m.kind,
            m.tags,
            m.content,
        ];
        const s = JSON.stringify (a);
        const h = await sha256_hex(s);
        return h;
    }

    async function sendNostrEventToRelay(event, relay) {
        return new Promise(function (ok, err) {

            const data = JSON.stringify(event);
            const socket = new WebSocket(relay);

            let sent = false;

            function drop() {
                clearTimeout(to);
                socket.close();
                err();
            }

            const to = setTimeout(function () {
                if (sent)
                    return;

                console.log("timeout relay", relay);
                drop();

            }, 3000);

            socket.onopen = function() {
                // console.log("opened connection to relay", relay, "sending", event);
                socket.send(data);
            };

            socket.onerror = function(event) {
                console.log("relay", relay, "error", event);
                drop();
            };

            socket.onmessage = function(e) {
                try
                {
                    const d = JSON.parse (e.data);
                    // console.log("relay", relay, "message", d);
                    if (!d || !d.length || d.length < 4)
                    {
                        drop();
                        return;
                    }

                    if (d[0] != "OK" || d[1] != event[1].id || d[2] != true)
                    {
                        drop ();
                        return;
                    }

                    // all ok
                    sent = true;
                    clearTimeout(to);
                    socket.close();
                    ok(relay);
                }
                catch(er)
                {
                    drop();
                }
            };
        });
    }

    function getRelayIndex (r) {
        for (const i in relays)
            if (relays[i] == r)
                return i;
        return 0;
    }

    async function sendNostrMessage(tmpl, pref_relays) {

        let msg = {
            kind: tmpl.kind,
            content: tmpl.content,
            tags: tmpl.tags,
        };

        // set msg fields
        msg.created_at = Math.floor((new Date()).getTime() / 1000);

        try
        {
//      await enableNostr();

            msg.pubkey = await window.nostr.getPublicKey();

            msg.id = await getNostrEventID(msg);

            // sign
            msg = await window.nostr.signEvent(msg);
        }
        catch (e)
        {
            console.log("failed to sign", e, msg);
            toastError("Failed to sign message with browser extension");
            return false;
        }

        // wrap to event
        const event = ["EVENT", msg];

        // take 10 known relays
        let rs = [];
        for (const i in relays)
        {
            if (rs.length >= 10)
                break;

            rs.push(i);
        }

        // add/prioritize mentioned relays
        for (const t of event[1].tags)
        {
            if (t.length > 2)
            {
                let r = t[2];
                for (let i = 0; i < rs.length; i++)
                {
                    if (relays[rs[i]] == r)
                    {
                        // put mentioned relays to the front of the list
                        const r1 = rs[0];
                        rs[0] = rs[i];
                        rs[i] = r1;
                        r = null;
                        break;
                    }
                }

                if (r)
                {
                    for (const i in relays)
                        if (relays[i] == r)
                            rs.unshift(i);
                }
            }
        }

        let sent_rs = {};
        let reqs = [];
        for (const r of rs)
        {
            const req = sendNostrEventToRelay(event, relays[r]);
            reqs.push (req);
            sent_rs[relays[r]] = 1;
        }

        if (pref_relays)
        {
            for (const r of pref_relays)
            {
                if (r in sent_rs)
                    continue;

                const req = sendNostrEventToRelay(event, relays[r]);
                reqs.push (req);
            }
        }

        try
        {
            const r = await Promise.any(reqs);
            msg.relays = [getRelayIndex(r)];
        }
        catch (e)
        {
            msg = null; // failed
        }

        return msg;
    }

    function verifyNostrSignature(event) {
        return window.nobleSecp256k1.schnorr.verify(event.sig, event.id, event.pubkey);
    }

    async function validateNostrEvent(event) {
        if (event.id !== await getNostrEventID(event)) return false
        if (typeof event.content !== 'string') return false
        if (typeof event.created_at !== 'number') return false

        if (!Array.isArray(event.tags)) return false
        for (let i = 0; i < event.tags.length; i++) {
            let tag = event.tags[i]
            if (!Array.isArray(tag)) return false
            for (let j = 0; j < tag.length; j++) {
                if (typeof tag[j] === 'object') return false
            }
        }

        return true
    }

    const sockets = {};

    function closeSocket(relay) {
        if (relay in sockets)
            sockets[relay].drop();
    }

    function getNostrEvents(sub, relay) {
        return new Promise(function (ok, err) {

            const to = setTimeout(function () {
                // relay w/o EOSE support?
                if (socket?.events.length)
                {
                    console.log("relay w/o EOSE", relay, "end by timeout");
                    socket.done(sub_id);
                }
                else if (socket)
                {
                    console.log("timeout relay", relay);
                    socket.drop();
                }
                else
                {
                    console.log("failed to connect to", relay);
                    err();
                }
            }, 5000);

            const was_opened = relay in sockets;
            const socket = was_opened ? sockets[relay] : new WebSocket(relay);
            sockets[relay] = socket;

            const sub_id = Math.random() + "";
            const req = [
                "REQ",
                sub_id,
                sub,
            ];

            if (!was_opened)
            {
                socket.tos = {};
                socket.events = [];
                socket.err = {};
                socket.ok = {};
                socket.queue = [];

                socket.drop = function () {
                    for (const sub_id in socket.tos)
                        clearTimeout(socket.tos[sub_id]);

                    for (const sub_id in socket.err)
                        socket.err[sub_id]();

                    socket.close();
                    delete sockets[relay];
                }

                socket.done = async function (sub_id) {

                    // clear timeout
                    clearTimeout(socket.tos[sub_id]);
                    delete socket.tos[sub_id];
                    delete socket.err[sub_id];

                    // unsubscribe
                    socket.send(JSON.stringify(["CLOSE", sub_id]));

                    // collect events for this sub first
                    const sub_events = [];
                    const events = [];
                    for (const v of socket.events)
                    {
                        if (v.s != sub_id)
                            events.push(v);
                        else
                            sub_events.push(v.e);
                    }

                    // replace w/ filtered list
                    socket.events = events;

                    // now check the res array in async way
                    const res = [];
                    for (const e of sub_events)
                    {
                        if (!await validateNostrEvent(e)
                            || !verifyNostrSignature(e)
                        )
                        {
                            console.log("bad event from relay", relay, e);
                        }
                        else
                        {
                            res.push(e);
                        }
                    }

                    // done
                    //		    console.log("res", sub_id, res.length);

                    const ok = socket.ok[sub_id];
                    delete socket.ok[sub_id];

                    ok(res);
                }

                socket.onerror = function(event) {
                    console.log("relay", relay, "error", event);
                    socket.drop();
                };

                socket.onmessage = async function(e) {
                    try
                    {
                        const d = JSON.parse (e.data);
                        // console.log("relay", relay, "message", d);
                        if (!d || !d.length)
                        {
                            socket.drop();
                            return;
                        }

                        if (d[0] == "NOTICE" && d.length == 2)
                        {
                            console.log("notice from", relay, d[1]);
                            return;
                        }

                        if (d[0] == "EOSE")
                        {
                            // console.log("eose", d[1], "events", socket.events.length);
                            socket.done(d[1]);
                            return;
                        }

                        if (d[0] != "EVENT" || d.length < 3)
                        {
                            console.log("unknown message from relay", relay, d);
                            socket.drop ();
                            return;
                        }

                        const ev = d[2];
                        if (!ev.id
                            || !ev.pubkey
                            || !ev.sig
                        )
                        {
                            console.log("bad event from relay", relay, ev);
                            socket.drop ();
                            return;
                        }
                        // console.log("add event", ev.id, "events", socket.events.length);
                        socket.events.push({e: ev, s: d[1]});
                    }
                    catch(er)
                    {
                        console.log("relay", relay, "bad message", e, "error", er);
                        socket.drop();
                    }
                };

                socket.onopen = function() {
                    // console.log("opened connection to relay", relay, "queue", socket.queue.length);
                    for (const req of socket.queue)
                        socket.send(JSON.stringify(req));
                    socket.queue.length = 0;
                };

            }

            // set handlers
            socket.err[sub_id] = err;
            socket.ok[sub_id] = ok;

            // set timeout for this request
            socket.tos[sub_id] = to;

//      console.log("sending", req, "to", relay, "was_opened", was_opened);
            if (socket.readyState == 1) // OPEN?
                socket.send(JSON.stringify(req));
            else
                socket.queue.push(req);
        });
    }

    async function getEventJson(id) {
        const sub = {
            ids: [id],
            limit: 1
        };
        const events = await getNostrEvents(sub, RELAY_ALL);
        if (events)
            return JSON.stringify (events[0], null, 2);
        return "";
    }

    async function getProfileJson(pk) {
        const sub = {
            authors: [pk],
            kinds: [0],
            limit: 1
        };
        const events = await getNostrEvents(sub, RELAY_ALL);
        if (events)
            return JSON.stringify (events[0], null, 2);
        return "";
    }

    async function getContactsJson(pk) {
        const sub = {
            authors: [pk],
            kinds: [3],
            limit: 1
        };
        const events = await getNostrEvents(sub, RELAY_ALL);
        if (events)
            return JSON.stringify (events[0], null, 2);
        return "";
    }

    async function getLatestNostrEvent(kind, pubkey) {

        let rs = [];
        for (const i in relays)
        {
            if (rs.length >= 3)
                break;

            rs.push(i);
        }
        // nostr-band
        if ("10000" in relays)
            rs.push("10000");

        const sub = {
            authors: [pubkey],
            kinds: [kind],
            limit: 1,
        };

        let reqs = [];
        for (const r of rs)
        {
            const req = getNostrEvents(sub, relays[r]);
            reqs.push (req);
        }

        const replies = await Promise.allSettled(reqs);
        // console.log("replies", replies);
        let latest = null;
        for (let i = 0; i < replies.length; i++)
        {
            const r = replies[i];
            if (r.status != "fulfilled")
                continue;

            for (const e of r.value)
            {
                if (!latest || e.created_at > latest.created_at)
                {
                    latest = e;
                    latest.relay = rs[i]; // relay index
                    latest.last_update = (new Date()).getTime(); // millis
                }
            }
        }

        return latest;
    }

    async function sendNostrReply(eid, root, relay, root_relay) {
        //	      console.log("send", eid, "root", root, "relay", relay, "root_relay", root_relay);

        if (!window.nostr)
            return;

        const text = $("#nostr-"+eid+" textarea").val().trim();
        if (!text)
        {
            $("#nostr-"+eid+" .hint").html("Please type something!");
            return;
        }

        let msg = {
            kind: 1,
            content: text,
            tags: [[
                "e",
                eid,
                relays[relay],
                "reply_to"
            ]],
        }

        if (root != eid)
        {
            msg.tags.push([
                "e",
                root,
                relays[root_relay],
                "root"
            ]);
        }

        msg = await sendNostrMessage(msg);
        if (msg)
            toastOk("Message sent", "Your post was submitted to Nostr network");
        else
            toastError("Failed to send to Nostr network");

        if (msg)
        {
            $("#nostr-"+eid+" textarea").val("");
            $("#nostr-"+eid+" .nostr-reply-form").addClass("d-none");

            // NOTE: msg now contains at least one relay

            msg.author = {
                pubkey: msg.pubkey,
                name: "You"
            };
            msg.replies = 0;
            msg.upvotes = 0;
            msg.downvotes = 0;

            const fake_root = {
                id: root,
                relays: [getRelayIndex(root_relay)]
            };

            console.log("printing", msg, "root", fake_root);
            const html = formatEvent({e: msg, root: fake_root, options: "no_reply"});
            $(html).insertAfter($("#nostr-"+eid));
        }
        else
        {
            $("#nostr-"+eid+" .nostr-reply-button").attr("disabled", false);
        }
    }

    async function sendNostrUrlReaction(url, str) {
        if (!window.nostr)
        {
            $("#login-modal").modal("show");
            return;
        }

        let msg = {
            kind: 7, // reaction, NIP-25
            content: str,
            tags: [[
                "r",
                url
            ]],
        }

        msg = await sendNostrMessage(msg);
        if (!msg)
            toastError("Failed to send to Nostr network");
        else
            toastOk("Thank you!", "Your reaction is now stored on the Nostr network. It will help us rank search result better, and help other people choose the best content.");
    }

    function formatSearchHistoryUrl(q, p, type, sort, scope) {
        const url = new URL(window.location);
        url.pathname = "/";
        url.searchParams.delete('embed');
        url.searchParams.set('q', q);
        if (p)
            url.searchParams.set('p', p);
        else
            url.searchParams.delete('p');

        if (type)
            url.searchParams.set('type', type);
        else
            url.searchParams.delete('type');

        if (sort)
            url.searchParams.set('sort', sort);
        else
            url.searchParams.delete('sort');

        if (scope)
            url.searchParams.set('scope', scope);
        else
            url.searchParams.delete('scope');

        url.searchParams.delete('trending');

        return url;
    }

    async function updateNostrContactList() {
        if (!window.nostr || !login_pubkey)
            return;

        if (!latest_contact_list)
        {
            const pk = login_pubkey; // await window.nostr.getPublicKey();
            $("#search-spinner").removeClass("d-none");
            // console.log("relays", relays);
            latest_contact_list = await getLatestNostrEvent(KIND_CONTACT_LIST, pk);
            $("#search-spinner").addClass("d-none");
            console.log("latest_contact_list", latest_contact_list);
        }

        updateFollows();
    }


    async function updateNostrLists() {
        if (window.nostr && login_pubkey && !latest_lists)
        {
            // console.log("relays", relays);
            latest_lists = await getLatestLists(login_pubkey);
            console.log("latest_lists", latest_lists);
        }

        updateLists();
    }

    async function updateNostrLabels() {
        if (window.nostr && login_pubkey && !latest_labels)
        {
            // console.log("relays", relays);
            latest_labels = await getLatestLabels(login_pubkey);
            console.log("latest_labels", latest_labels);
        }

        updateLabels();
    }

    function getContactRelays() {
        let contact_relays = [];
        try
        {
            const rs = JSON.parse(latest_contact_list.content);
            for (const r in rs)
            {
                if (rs[r].write)
                    contact_relays.push(r);
            }
        }
        catch (e)
        {
            console.log("Failed to parse relays", e);
        }
        console.log("contact_relays", contact_relays);

        return contact_relays;
    }

    async function editPubkeyList(list, adds, dels, relay) {

        const pk = login_pubkey;

//    const pk = await window.nostr.getPublicKey();
        console.log("edit list", list, "pk", pk, "adds", adds, "dels", dels, "relay", relay, relays[relay]);

        if (!latest_contact_list)
        {
            toastError("Cannot find your current contact list on our relays");
            return;
        }

        for (target of adds) {

            let index = -1;
            for (let i = 0; i < list.tags.length; i++)
            {
                const t = list.tags[i];
                if (t.length < 2 || t[0] != "p")
                    continue;

                if (t[1] == target)
                {
                    index = i;
                    break;
                }
            }

            if (index >= 0)
            {
                console.log("already in the list", target);
            }
            else
            {
                console.log("add", target);
                const tag = ["p", target];
                if (relay && (relay in relays))
                    tag.push(relays[relay]);
                list.tags.push (tag);
            }
        }

        for (target of dels) {

            let index = -1;
            for (let i = 0; i < list.tags.length; i++)
            {
                const t = list.tags[i];
                if (t.length < 2 || t[0] != "p")
                    continue;

                if (t[1] == target)
                {
                    index = i;
                    break;
                }
            }

            if (index < 0)
            {
                console.log("already removed from the list", target);
            }
            else
            {
                console.log("remove", target);
                list.tags.splice (index, 1);
            }
        }

        const contact_relays = getContactRelays();

        console.log("updated", list.tags.length);

        // returns the new object w/ new id, sig etc
        return await sendNostrMessage(list, contact_relays);
    }

    async function ensureContactList() {
        if (!latest_contact_list && login_pubkey && window.nostr)
            latest_contact_list = await getLatestNostrEvent(KIND_CONTACT_LIST, login_pubkey);
    }

    async function ensureFollowing(target, relay, unfollow, e) {

        if (!login_pubkey || !window.nostr) {
            $("#login-modal").modal("show");
            return;
        }

        if (!relays)
        {
            toastError("No active relays found, sorry!");
            return;
        }

        // get our own latest contact list if it wasn't pre-loaded yet
        await ensureContactList();

        const adds = unfollow ? [] : [target];
        const dels = unfollow ? [target] : [];

        // edit the list
        latest_contact_list = await editPubkeyList(latest_contact_list, adds, dels, relay);

        if (latest_contact_list)
        {
            updateFollows();
        }
        else
        {
            toastError("Failed to send to Nostr network");

            // re-fetch the contact list in bg
            getLatestNostrEvent(KIND_CONTACT_LIST, login_pubkey).then((m) => {
                latest_contact_list = m;
                updateFollows();
            });
        }
    }

    function updateLatestList(list) {
        list.d = getTag(list, "d");
        list.name = getTag(list, "name") || list.d;
        list.desc = getTag(list, "description");
        list.size = 0;
        for (let t of list.tags)
        {
            if (t.length > 1 && t[0] == "p" && t[1].length == 64)
                list.size++;
        }

        for (let i = 0; i < latest_lists.length; i++)
        {
            const l = latest_lists[i];
            if (l.kind == list.kind && l.d == list.d)
            {
                latest_lists[i] = list;
                return;
            }
        }
        latest_lists.push(list);
    }

    async function ensureListed(target, relay, list_id, unlist) {

        if (!login_pubkey || !window.nostr) {
            $("#login-modal").modal("show");
            return;
        }

        if (!relays)
        {
            toastError("No active relays found, sorry!");
            return;
        }

        // we need CL for write relays
        await ensureContactList();

        // load lists
        if (!latest_lists)
            latest_lists = await getLatestLists(login_pubkey);

        let list = null;
        for (const l of latest_lists)
        {
            if (l.id == list_id)
            {
                list = l;
                break;
            }
        }
        if (!list)
        {
            toastError("Target list not found on relays");
            return;
        }

        const adds = unlist ? [] : [target];
        const dels = unlist ? [target] : [];

        // edit the list
        list = await editPubkeyList(list, adds, dels, relay);

        if (list)
        {
            updateLatestList(list);
            updateLists();
        }
        else
        {
            toastError("Failed to send to Nostr network");
        }
    }

    async function updateFollows() {
        $(".follow-button").each(function (i, el) {
            const e = $(el);
            const pk = getBranchAttr(e, 'data-pubkey');

            let following = false;
            if (latest_contact_list)
            {
                for (const t of latest_contact_list.tags)
                {
                    if (t.length >= 2 && t[0] == "p" && t[1] == pk)
                    {
                        following = true;
                        break;
                    }
                }
            }
            // console.log("follow", pk, following);

            if (following)
            {
//	e.find(".label").html("Follow");
                e.find(".bi").removeClass("bi-person-plus");
                e.find(".bi").addClass("bi-person-plus-fill");
                e.attr("data-following", true);
                e.removeClass("btn-outline-secondary");
                e.addClass("btn-outline-success");
            }
            else
            {
//	e.find(".label").html("Follow");
                e.find(".bi").addClass("bi-person-plus");
                e.find(".bi").removeClass("bi-person-plus-fill");
                e.attr("data-following", false);
                e.addClass("btn-outline-secondary");
                e.removeClass("btn-outline-success");
            }
        });
    }

    async function updateLists() {

        $(".list-button").each(function (i, el) {
            const e = $(el);
            const pk = getBranchAttr(e, 'data-pubkey');

            let html = "";
            let listed = false;
            if (latest_lists)
            {
                let pubkey_lists = {};
                for (const list of latest_lists)
                {
                    for (const t of list.tags)
                    {
                        if (t.length >= 2 && t[0] == "p" && t[1] == pk)
                        {
                            listed = true;
                            pubkey_lists[list.id] = true;
                            break;
                        }
                    }
                }

                for (const list of latest_lists)
                {
                    html += `
<li><button class="dropdown-item list-unlist-button" data-list='${list.id}' data-listed='${list.id in pubkey_lists}'>${pubkey_lists[list.id] ? '<i class="bi bi-check"></i>' : ""} ${list.name} <b>${list.size}</b></button></li>
`;
                }
                html += `<li><hr class="dropdown-divider"></li>`;
            }
            html += `<li><button class="dropdown-item list-unlist-button" data-list=''>New list</button></li>`;

            e.parent().find(".dropdown-menu").html(html);

            if (listed)
            {
                e.find(".bi").removeClass("bi-bookmark-plus");
                e.find(".bi").addClass("bi-bookmark-plus-fill");
                e.attr("data-listed", true);
                e.removeClass("btn-outline-secondary");
                e.addClass("btn-outline-success");
            }
            else
            {
                e.find(".bi").addClass("bi-bookmark-plus");
                e.find(".bi").removeClass("bi-bookmark-plus-fill");
                e.attr("data-listed", false);
                e.addClass("btn-outline-secondary");
                e.removeClass("btn-outline-success");
            }
        });

        $(".list-unlist-button").on("click", (e) => {
            if (window.nostr && login_pubkey)
            {
                const pk = getBranchAttr($(e.target), 'data-pubkey');
                const list = getBranchAttr($(e.target), 'data-list');
                const relay = getBranchAttr($(e.target), 'data-relay');
                const listed = getBranchAttr($(e.target), 'data-listed');
                // console.log("list-unlist", pk, list, relay, listed);
                if (list)
                {
                    // console.log("ensureListed", pk, list, relay, listed);
                    ensureListed(pk, relay, list, listed == "true");
                }
                else
                {
                    listUnlistAll(false, pk);
                }
            }
            else
            {
                $("#login-modal").modal("show");
            }
        });

    }

    async function updateLabels(new_event) {

        let labels = [];
        if (latest_labels)
            labels.push(...latest_labels);

        if (window.nostr && login_pubkey) {
            let eids = [];
            $(".label-button").each(function (i, el) {
                const e = $(el);
                const eid = getBranchAttr(e, 'data-eid');
                eids.push(eid);
            });

            const sub = {
                kinds: [KIND_LABEL],
                authors: [login_pubkey],
                '#L': [LABEL_CATEGORY],
                '#e': eids,
                limit: 200,
            };

            const events = await getNostrEvents(sub, RELAY_ALL);
            if (events)
                labels.push(...events);
        }

        if (new_event) {
            if (new_event.kind == KIND_DELETE) {

                let id = null;
                for (const t of new_event.tags) {
                    if (t.length >= 2 || t[0] == "e")
                        id = t[1];
                }

                labels = labels.filter(l => l.id != id);
            } else {
                labels.push(new_event);
            }
        }

        $(".label-button").each(function (i, el) {
            const e = $(el);
            const eid = getBranchAttr(e, 'data-eid');

            let html = "";
            let labelled = false;

            // list of labels, recent and ones referring to this specific event
            if (labels && labels.length)
            {
                let event_labels = {};
                let unique_labels = {};
                for (const e of labels)
                {
                    let label = "";
                    for (const t of e.tags)
                    {
                        if (t.length >= 2 && t[0] == "l")
                            label = t[1];
                    }
                    if (!label)
                        continue;

                    unique_labels[label] = true;
                    for (const t of e.tags)
                    {
                        if (t.length >= 2 && t[0] == "e" && t[1] == eid)
                        {
                            labelled = true;
                            event_labels[label] = true;
                            break;
                        }
                    }
                }

                for (const label in unique_labels)
                {
                    html += `
<li><button class="dropdown-item label-unlabel-button" data-label='${label}' data-labelled='${label in event_labels}'>${label in event_labels ? '<i class="bi bi-check"></i>' : ""} ${label}</button></li>
`;
                }
                html += `<li><hr class="dropdown-divider"></li>`;
            }
            html += `<li><button class="dropdown-item label-unlabel-button" data-label=''>New label</button></li>`;

            e.parent().find(".dropdown-menu").html(html);

            if (labelled)
            {
                e.find(".bi").removeClass("bi-tags");
                e.find(".bi").addClass("bi-tags-fill");
                e.attr("data-labelled", true);
                e.removeClass("btn-outline-secondary");
                e.addClass("btn-outline-success");
            }
            else
            {
                e.find(".bi").addClass("bi-tags");
                e.find(".bi").removeClass("bi-tags-fill");
                e.attr("data-labelled", false);
                e.addClass("btn-outline-secondary");
                e.removeClass("btn-outline-success");
            }
        });

        $(".label-unlabel-button").on("click", (e) => {
            if (window.nostr && login_pubkey)
            {
                const eid = getBranchAttr($(e.target), 'data-eid');
                const label = getBranchAttr($(e.target), 'data-label');
                const labelled = getBranchAttr($(e.target), 'data-labelled');
                if (label)
                {
                    ensureLabelled(eid, label, labelled == "true");
                }
                else
                {
                    addLabel(eid);
                }
            }
            else
            {
                $("#login-modal").modal("show");
            }
        });

    }

    function pushUrl(url) {
        embed = url.searchParams.has("embed");
        if (embed)
            $("body").addClass("embed-mode");
        else
            $("body").removeClass("embed-mode");
        window.history.pushState({}, '', url);
    }

    function pushSearchState(q, p, type, sort, scope) {
        //	console.log("push", q, p, t, media);
        const url = formatSearchHistoryUrl(q, p, type, sort, scope);
        pushUrl(url);
        search({q, p, type, sort, scope});
    }

    let webln_enabled = false;
    async function enableWebln() {
        if (webln_enabled)
            return true;

        // wait for webln to init
        const w = await detectWebLNProvider(10000);
        if (!w)
        {
            toastError("WebLN not available!");
            return false;
        }

        // enable it
        try
        {
            await window.webln.enable();
            webln_enabled = true;
        }
        catch (e)
        {
            toastError("Failed to enable WebLN: "+e);
            return false;
        }

        return true;
    }

    // https://stackoverflow.com/a/34310051
    function toHex(byteArray)
    {
        return Array.from(byteArray, function(byte) {
            return ('0' + (byte & 0xFF).toString(16)).slice(-2);
        }).join('')
    }

    function scrollTop()
    {
        $('html, body').animate({
            scrollTop: $("body").offset().top
        }, 100);
    }

    function formatEventMenu(eid, active_label)
    {
        let label = "Overview";
        if (active_label)
        {
            label = `
<h2><a class="btn btn-lg btn-outline-secondary open-event-overview" href="/${getNoteId(eid)}/overview"><i class="bi bi-list"></i> Overview</a> &rarr; 
${active_label}
`
        }

        return `
<div data-eid='${eid}'>
<h2>${label}</h2>
</div>
`;
    }

    function showPost(event_id, sub_page) {
        setRobots(true);
        setQuery('')

        console.log("show post", event_id);

        $("#search-spinner").removeClass("d-none");
        $("#sb-spinner").removeClass("d-none");

        // proper query
        // const q = "thread:" + event_id + " type:posts -filter:spam";

        const eq = encodeURIComponent(event_id);
        const url = NOSTR_API + "method=comments&id=" + eq 
        //	      + (ep ? "&p=" + ep : "")
        ;

        $.ajax({
            url,
        }).fail((x, r, e) => {
            $("#search-spinner").addClass("d-none");
            $("#sb-spinner").addClass("d-none");

            toastError("Search failed: "+e);
        }).done (r => {

            // stop spinning
            $("#search-spinner").addClass("d-none");
            $("#sb-spinner").addClass("d-none");

            // unstick from the window-bottom
            $("footer").removeClass("fixed-bottom");

            console.log("results", r);

            setRelays(r.relays);

            // header of search results
            let html = "";

            if (!r.comments.length)
            {
                html += "<p class='mt-4'>Nothing found :(<br>";
                html += formatScanRelays(event_id);
            }
            else
            {
        const u = r.comments[0];
        html += "<div class='thread-branch'>";
        if (u.root)
          html += formatEvent({e: u.root});
        
        if (u.reply_to)
        {
          if (u.root)
            html += `
      <div class='text-muted'><small>In a thread by @${getAuthorName(u.root)}</smalL></div>
      `;
          html += formatEvent({e: u.reply_to, root: u.root, options: "no_offset"});
        }
      
        const root = u.root || u.reply_to;
        
        if (!u.reply_to && u.root)
          html += `
      <div class='text-muted'><small>Replying to @${getAuthorName(u.root)}</smalL></div>
      `;
      
        if (u.reply_to)
          html += `
      <div class='text-muted'><small>Replying to @${getAuthorName(u.reply_to)}</small></div>
      `;
        html += "</div>"; // thread-branch
        
        html += formatEvent({e: u, root, show_post: true, options: "thread_root,no_offset,main"});
        
        let t = (u.author?.name || u.pubkey.substring(0,8)) + ": ";
        t += u.content.substring (0, 50) + "... " + getNoteId(u.id);
        document.title = t;
      
        html += '<div id="serp">';
        if (sub_page)
        {
          html += "Loading...";
        }
        else if (u.children?.length)
        {
          html += formatEventMenu(event_id, `Replies (${u.children.length})`);
          
          for (const c of u.children)
          {
            if (c.reply_to)
              html += formatEvent({e: c.reply_to, root: root || u, options: "no_offset"});
      
            // direct children don't need offset
            let options = "no_offset";
            html += formatEvent({e: c, root: root || u, options});
      
            if (c.children)
            {
              for (const cc of c.children)
          html += formatEvent({e: cc, root: root || u});
            }
          }
      
        }
        else
        {
          html += formatEventMenu(event_id, `Replies (0)`);
        }
        html += "</div>"; // #serp
            }

            // set results
            $("#results").html(html);
            $("#welcome").addClass("d-none");
            $("#loading").addClass("d-none");
            $("#freebies").addClass("d-none");

            attachSerpEventHandlers("#results");

            addOnNostr(updateNostrLabels);
            updateNostrLabels();

            if (sub_page == "overview")
            {
                getEventOverview(event_id);
            }
            else if (sub_page == "zaps")
            {
                getZapsFor(event_id);
            }
            else
            {
      //	getComments(event_id);
            }

            if (embed) {
                $(".main").css("visibility", "visible");
                $("#serp").css("display", "none");
                $(".thread-branch").css("display", "none");
            }
        });
    }

  /*  function getComments(event_id) {
    console.log("show post", event_id);
    
    $("#search-spinner").removeClass("d-none");

    const eq = encodeURIComponent(event_id);
    const url = NOSTR_API + "method=comments&id=" + eq;

    $.ajax({
      url,
    }).fail((x, r, e) => {
      $("#search-spinner").addClass("d-none");

      toastError("Search failed: "+e);
    }).done (r => {

      // stop spinning
      $("#search-spinner").addClass("d-none");

      console.log("comments", r);

      let html = "";

      html += formatEventMenu(event_id, `Replies (${r.comments?.length})`);
	  
      for (const c of r?.comments)
      {
	if (c.reply_to)
	  html += formatEvent({e: c.reply_to, root: c.root, options: "no_offset"});

	let options = "";
	if (c.reply_to_id == event_id)
	  options = "no_offset";
	html += formatEvent({e: c, root: c.root, options});

	if (c.children)
	{
	  for (const cc of c.children)
	    html += formatEvent({e: cc, root: c.root});
	}
      }

      $("#serp").html(html);
      
    });    
  }
*/

    function formatProfileMenu(pubkey, active_label)
    {
        let label = "Overview";
        if (active_label)
        {
            label = `
<h2><a class="btn btn-lg btn-outline-secondary open-profile-overview" href="/${getNpub(pubkey)}/overview"><i class="bi bi-list"></i> Overview</a> &rarr; 
${active_label}
`
        }

        return `
<div data-pubkey='${pubkey}'>
<h2>${label}</h2>
</div>
`;
    }

    function showProfile(pubkey, sub_page)
    {
        setRobots(true);
        setQuery('')

        // console.log("show profile", pubkey);

        $("#search-spinner").removeClass("d-none");
        $("#sb-spinner").removeClass("d-none");

        const q = pubkey + " -filter:spam";

        const eq = encodeURIComponent(q);

        const url = NOSTR_API + "method=search&count=10&q=" + eq
        ;

        $.ajax({
            url,
        }).fail((x, r, e) => {
            $("#search-spinner").addClass("d-none");
            $("#sb-spinner").addClass("d-none");

            toastError("Search failed: "+e);
        }).done (r => {

            // stop spinning
            $("#search-spinner").addClass("d-none");
            $("#sb-spinner").addClass("d-none");

            // unstick from the window-bottom
            $("footer").removeClass("fixed-bottom");

            console.log("results", r);

            setRelays(r.relays);

            // header of search results
            let html = "";

            // reset
            serp = [];
            if (r.people.length)
            {
                if (!embed)
                    html += `<h2>Profile</h2>`;

                for (const p of r.people)
                {
                    serp.push (p);

                    html += formatPerson({p, show_profile: true});
                    let t = p.name + " on Nostr, ";
                    if (p.nip05 && p.nip05_verified)
                        t += p.nip05 + ", " ;

                    t += "pubkey " + getNpub(p.pubkey) + " / " + p.pubkey;
                    document.title = t;

                    // only the first one?
                    break;
                }
            }
            else
            {
                html += "<p class='mt-4'>Profile not found :(<br>";
                html += formatScanRelays(pubkey);
            }

            html += '<div id="serp">';
            if (sub_page)
            {
                html += "Loading...";
            }
            else if (r.serp.length)
            {
                const label = `Posts & replies (${r.result_count})`;
                html += formatProfileMenu(pubkey, label);

                // print results
                for (const u of r.serp)
                {
                    if (u.root)
                        html += formatEvent({e: u.root});

                    if (u.reply_to)
                    {
                        html += formatEvent({e: u.reply_to, root: u.root});
                    }

                    const root = u.root || u.reply_to;

                    html += formatEvent({e: u, root});

                    if (u.children)
                    {
                        for (const c of u.children)
                        {
                            if (c.reply_to)
                                html += formatEvent({e: c.reply_to, root: root || u});

                            html += formatEvent({e: c, root: root || u});
                        }
                    }
                }

                const more = formatPageUrl(getNpub(pubkey), 0, "posts");
                html += `<div class='mb-5'><a href="${more}">View all ${r.result_count} posts &rarr;</a></div>`;
            }
            html += "</div>"; // #serp

            // set results
            $("#results").html(html);
            $("#welcome").addClass("d-none");
            $("#loading").addClass("d-none");
            $("#freebies").addClass("d-none");

            /*      $("#results .follow-button").on("click", (e) => {
	if (window.nostr)
	{
	  const pk = getBranchAttr($(e.target), 'data-pubkey');
	  const relay = getBranchAttr($(e.target), 'data-relay');
	  const following = getBranchAttr($(e.target), 'data-following');
	  ensureFollowing(pk, relay, following == "true", e.target);
	}
	else
	{
	  $("#login-modal").modal("show");
	  // openNostrProfile(e);
	}
      });
*/
            $("#results .following").on("click", (e) => {
                const pk = getBranchAttr($(e.target), 'data-pubkey');
                const q = "following:" + getNpub(pk);
                startSearchScroll(q, 0, 'profiles', '');
            });

            $("#results .show-feed").on("click", (e) => {
                const pk = getBranchAttr($(e.target), 'data-pubkey');
                const q = "following:" + getNpub(pk);
                startSearchScroll(q, 0, 'posts', '');
            });

            $("#results .followed").on("click", (e) => {
                const pk = getBranchAttr($(e.target), 'data-pubkey');
                showFollows(pk, true);
            });

            attachSerpEventHandlers("#results");

            addOnNostr(updateNostrContactList);
            addOnNostr(updateNostrLists);
            updateNostrContactList();
            updateNostrLists();

            //	    if (r.timeline)
            //		showTimeline("#timeline", r.timeline,
            //			     {c: "Number of " + (type == "people" ? "profiles" : "posts")});

            // sub pages?
            // load & replace the serp
            if (sub_page == "overview")
            {
                getProfileOverview(pubkey);
            }
            else if (sub_page == "zaps-received")
            {
                getZapsTo(pubkey);
            }
            else if (sub_page == "zaps-processed")
            {
                getZapsVia(pubkey);
            }
            else if (sub_page == "zaps-sent")
            {
                getZapsBy(pubkey);
            }

            if (embed) {
                $(".main").css("visibility", "visible");
                $("#serp").css("display", "none");
            }
        });
    }

    function showProfileEdits(pubkey)
    {
        setRobots(false);

        const url = NOSTR_API + "method=profile_edits&pubkey=" + encodeURIComponent(pubkey);

        $.ajax({
            url,
        }).fail((x, r, e) => {
            $("#search-spinner").addClass("d-none");

            toastError("Request failed: "+e);
        }).done (r => {

            // stop spinning
            $("#search-spinner").addClass("d-none");

            console.log("edits", r);

            setRelays(r.relays);

            let html = `
<h1>Profile edit history (${r.edits.length})</h1>
`;

            for (const e of r.edits)
            {
                html += formatPerson({p: e, show_profile: true, edits: true});
            }

            // set results
            $("#results").html(html);
            $("#welcome").addClass("d-none");
            $("#loading").addClass("d-none");

            attachSerpEventHandlers("#results");


        });
    }

    function setRobots(index) {
        // FIXME allow images/video for high TR accounts
        const c = (index ? "index" : "noindex") + ", follow, noimageindex, max-snippet:-1, max-image-preview:none, max-video-preview:-1, nositelinkssearchbox";
        document.querySelector('meta[name="robots"]').setAttribute("content", c);
    }

    function setType(type) {
        const t = $(`#object-types a[data-type=\"${type}\"]`).html();
        // console.log("type", type, t);
        $("#object-type").html(t);
        $("#object-type").attr("data-type", type);
    }

  function updateParamsState() {
    const params = deParams();
    // let path = document.location.pathname;

    console.log("params ", params, document.location);

        // update type
        let type = "all";
        if (params.type) {
            switch (params.type)
            {
                case "posts":
                case "profiles":
                case "zaps":
                case "long_posts": {
                    type = params.type;
                    break;
                }
            }
        }

        setType(type);

        $("#advanced-bar").addClass("d-none");

        embed = "embed" in params;
        if (embed)
            $("body").addClass("embed-mode");
        else
            $("body").removeClass("embed-mode");

    if (params.viewParam && params.viewParam.startsWith("trending")) {
      setQuery("");
      $("#results").html("");
      $("#welcome").removeClass("d-none");
      $("#loading").addClass("d-none");

      const type = params.viewValue;
      let date = params.viewDate;
      // console.log(segments, type, date);

            if (type == "profiles"
                || type == "posts"
                || type == "images"
                || type == "videos"
                || type == "audios"
            )
            {
                try
                {
                    if (date)
                    {
                        const d = new Date(date);
                        const tm = d.getTime();
                        console.log(d, tm);
                        if (tm < Date.parse("2023-01-01") || tm > Date.now ())
                            throw "Bad date"

                        const valid_date = formatDate(d);
                        console.log(date, valid_date);
                        if (valid_date != date)
                            throw "Bad date"
                    }
                    else
                    {
                        date = formatDate(new Date());
                    }

                    showTrending(type, date);
                    return;
                } catch (e) {
                    console.log(e);
                }
            }

            $("#results").html("Not found :(");
            setRobots(false);

            return;
        }

    if (
      params.viewParam &&
      (params.viewParam.startsWith("note1") ||
        params.viewParam.startsWith("npub1") ||
        params.viewParam.startsWith("nevent1") ||
        params.viewParam.startsWith("nprofile1"))
    ) {
      $("#welcome").addClass("d-none");
      $("#loading").removeClass("d-none");

      const id = params.viewParam;
      const edits = params.edits && params.edits == "edits";
      const sub_page = params.sub_page ? params.sub_page : "";

      try {
        console.log(id);
        const r = tools.nip19.decode(id);
        const q = r.data;

        console.log(r.type);
        if (r.type == "note") {
          showPost(q, sub_page);
        } else if (r.type == "npub") {
          // console.log("pubkey", q, "edits", edits);
          if (edits) showProfileEdits(q);
          else showProfile(q, sub_page);
        } else if (r.type == "nevent") {
          console.log("nevent", q);
          showPost(q.id, sub_page);
        } else if (r.type == "nprofile") {
          console.log("nprofile", q, "edits", edits);
          if (edits) showProfileEdits(q.pubkey);
          else showProfile(q.pubkey, sub_page);
        }

                return;
            } catch (e) {}

            setQuery("");
            $("#results").html("Not found :(");
            $("#welcome").removeClass("d-none");
            $("#loading").addClass("d-none");
            setRobots(false);
            return;
        }

        //	      console.log(params);

        if (params.advanced && (params.advanced == "sb" || params.advanced == "rss"))
        {
            $("#search").addClass("d-none");
            $("#advanced-search").removeClass("d-none");
            $(".as").addClass("d-none");
            $(".sb").removeClass("d-none");

            $("#create-search-bot").attr ("data-as", params.advanced);
            if (params.advanced == "sb")
            {
                $("#sb-title").html("Search bot query");
                $("#create-search-bot").html("Create Search Bot");
            }
            else if (params.advanced == "rss")
            {
                $("#sb-title").html("RSS feed query");
                $("#create-search-bot").html("Create RSS Feed");
            }
        }

        if (params.q)
        {
            const q = decodeURIComponent(params.q.replaceAll("+", " "));
            if (q)
            {
                setQuery(q);

                let p = 0;
                if (params.p)
                {
                    p = parseInt(decodeURIComponent(params.p || ''));
                    if (isNaN (p))
                        p = 0;
                }

                const t = decodeURIComponent(params.t || '');
                const type = decodeURIComponent(params.type || '');
                const sort = decodeURIComponent(params.sort || '');
                const scope = decodeURIComponent(params.scope || '');
                activateSort(sort ? sort : "recent");
                activateScope(scope ? scope : "global");
                search({q, p, t, type, sort, scope});
                setRobots(false);
            }
        }
        else
        {
            setQuery("");
            $("#results").html("");
            $("#welcome").removeClass("d-none");
            $("#loading").addClass("d-none");

            // $("footer").addClass("fixed-bottom");

            const trending = params.trending || "profiles";
            showTrending(trending);
        }
    }

    function getBranchAttr(e, a) {
        while (e)
        {
            const v = e.attr(a);
            if (v)
                return v;
            e = e.parent ();
            if (e.prop("tagName") == "HTML" || !e.prop("tagName"))
                break;
        }
        return "";
    }

  function gotoEvent(eid) {
    const url = new URL(window.location);
    url.searchParams.set("viewParam", getNoteId(eid));
    url.search = "";
    pushUrl(url);
    showPost(eid);
    scrollTop();
  }

  function gotoProfile(pubkey) {
    const url = new URL(window.location);
    url.searchParams.set("viewParam", getNpub(pubkey));
    url.search = "";
    pushUrl(url);
    showProfile(pubkey);
    scrollTop();
  }

    function onEventClick(e) {
        if (e.target.nodeName != "A")
        {
            e.preventDefault();
            const eid = getBranchAttr($(e.target), 'data-eid');
            gotoEvent(eid);
        }
    }

    function onProfileClick(e) {
        e.preventDefault();
        const pubkey = getBranchAttr($(e.target), 'data-pubkey');
        gotoProfile(pubkey);
    }

    function attachSerpEventHandlers(sel) {
        $(sel).find (".nostr-reply").on("click", function (e) {
            const eid = getBranchAttr($(e.target), 'data-eid');
            //		      console.log(eid);
            $("#nostr-"+eid+" .nostr-reply-form").removeClass("d-none");
            $("#nostr-"+eid+" .nostr-reply-form textarea").focus();

            let hint = "Your message will be signed by your browser extension";
            if (!window.nostr)
            {
                hint = "Please install <a href='https://getalby.com' target='_blank'>Alby</a> or some other browser extension for key storage.";
                $("#nostr-"+eid+" .nostr-reply-button").attr("disabled", true);
                $("#nostr-"+eid+" textarea").attr("disabled", true);
            }

            $("#nostr-"+eid+" .hint").html(hint);

            return false;
        });

        $(sel).find (".nostr-cancel-button").on("click", (e) => {
            const eid = getBranchAttr($(e.target), 'data-eid');
            $("#nostr-"+eid+" .nostr-reply-form").addClass("d-none");
        });

        $(sel).find (".nostr-reply-button").on("click", (e) => {
            const eid = getBranchAttr($(e.target), 'data-eid');
            const root = getBranchAttr($(e.target), 'data-root');
            const relay = getBranchAttr($(e.target), 'data-relay');
            const root_relay = getBranchAttr($(e.target), 'data-root-relay');
            //		      console.log("reply ", eid, "root", root);

            $("#nostr-"+eid+" .nostr-reply-button").attr("disabled", true);

            sendNostrReply(eid, root, relay, root_relay);
        });

        $(sel).find("#follow-all").on("click", followAll);
        $(sel).find("#unfollow-all").on("click", unfollowAll);
        $(sel).find("#list-all").on("click", listAll);
        $(sel).find("#unlist-all").on("click", unlistAll);

        $(sel).find (".open-nostr-event").on("click", openNostrEvent);
        $(sel).find (".open-nostr-profile").on("click", openNostrProfile);
        $(sel).find ("a.nostr-thread").on("click", searchNostrEvent);
        $(sel).find (".open-event-text").on("click", onEventClick);
        $(sel).find (".nostr-event-link").on("click", onEventClick);
        $(sel).find (".nostr-profile-link").on("click", onProfileClick);
        $(sel).find (".open-profile-text").on("click", onProfileClick);
        $(sel).find (".embed-nostr-event").on("click", embedNostrEvent);
        $(sel).find (".embed-nostr-profile").on("click", embedNostrProfile);
        $(sel).find (".share-nostr-event").on("click", shareNostrEvent);
        $(sel).find (".share-nostr-profile").on("click", shareNostrProfile);
        $(sel).find (".open-zaps-for").on("click", openZapsFor);
        $(sel).find (".open-zaps-to").on("click", openZapsTo);
        $(sel).find (".open-zaps-via").on("click", openZapsVia);
        $(sel).find (".open-zaps-by").on("click", openZapsBy);
        $(sel).find (".open-profile-overview").on("click", openProfileOverview);
        $(sel).find (".open-event-overview").on("click", openEventOverview);
        $(sel).find ("#scan-relays").on("click", toggleScanRelays);

        $(sel).find (".copy-to-clip").on("click", async (e) => {
            const data = getBranchAttr($(e.target), 'data-copy');
            copyToClip(data);
        });

        $(sel).find (".show-relays").on("click", (e) => {
            const list = getBranchAttr($(e.target), 'data-relays');
            const ids = list.split(",");
            let str = "";
            for (const id of ids)
                str += relays[id] + "<br>";

            $("#relays-modal .modal-body").html("<pre>" + str + "</pre>");
            $("#relays-modal").modal("show");
        });

        $(sel).find (".show-event-json").on("click", async function (e) {
            const eid = getBranchAttr($(e.target), 'data-eid');
            const json = await getEventJson(eid);
            $("#json-modal .modal-body textarea").html(json);
            $("#json-modal").modal("show");
        });

        $(sel).find (".show-profile-json").on("click", async function (e) {
            const eid = getBranchAttr($(e.target), 'data-pubkey');
            const json = await getProfileJson(eid);
            $("#json-modal .modal-body textarea").html(json);
            $("#json-modal").modal("show");
        });

        $(sel).find (".show-contacts-json").on("click", async function (e) {
            const eid = getBranchAttr($(e.target), 'data-pubkey');
            const json = await getContactsJson(eid);
            $("#json-modal .modal-body textarea").html(json);
            $("#json-modal").modal("show");
        });

        $(sel).find (".player-button").on("click", (e) => {
            $(e.target).hide();
            $(e.target).parent().find(".play").show();
        });

        $(sel).find (".follow-button").on("click", (e) => {
            if (window.nostr && login_pubkey)
            {
                const pk = getBranchAttr($(e.target), 'data-pubkey');
                const relay = getBranchAttr($(e.target), 'data-relay');
                const following = getBranchAttr($(e.target), 'data-following');
                ensureFollowing(pk, relay, following == "true", e.target);
            }
            else
            {
                $("#login-modal").modal("show");
                // openNostrProfile(e);
            }
        });

        $(sel).find ("a[data-toggle=\"lightbox\"]").each(function (i, el) {el.addEventListener('click', Lightbox.initialize)});

    }

    function formatTrendingUrls(r) {

        let html = "";
        for (const u of r.urls)
        {
            html += `
<div class='row serp-url mb-3'>
<div class='col'><div class='card no-border'>
<div class='card-body' style='padding-left: 0; padding-bottom: 0'>
<div class='card-title mb-0' style='font-size: larger'>
<a target='_blank' href='${u.url}' class='serp-url-link'>${u.url}</a></div>

`;
            html += `
</div>
</div></div>
</div>
`;

            for (const t of u.threads)
            {
                html += formatEvent({e: t, root: t, options: "no_padding"});
            }

            if (u.threads_count > u.threads.length)
            {
                const more_url = formatPageUrl(u.url, 0, '', 'nostr');
                html += `
<div class='ms-5 mb-3'><small><a href='${more_url}' class='more-trending' data-url='${u.url}'>And ${u.threads_count - u.threads.length} more threads &rarr;</a></small></div>
`;
            }
        }

        $("#trending-urls").html(html);

        attachSerpEventHandlers("#trending-urls");

        $("#trending-urls a.more-trending").on("click", (e) => {
            const url = getBranchAttr($(e.target), 'data-url');
            startSearchScroll(url);
            return false;
        });
    }

    function formatTrendingHashtags(r) {

        let html = "";
        for (const h of r.hashtags)
        {
            const more_url = formatPageUrl(h.hashtag, 0, '', 'nostr');

            html += `
<div class='row serp-url mb-3'>
<div class='col'><div class='card no-border'>
<div class='card-body' style='padding-left: 0; padding-bottom: 0'>
<div class='card-title mb-0' style='font-size: larger'>
<a href='${more_url}' class='serp-url-link'>${h.hashtag}</a></div>

`;
            html += `
</div>
</div></div>
</div>
`;

            for (const t of h.threads)
            {
                html += formatEvent({e: t, root: t, options: "no_padding"});
            }

            if (h.threads_count > h.threads.length)
            {
                html += `
<div class='ms-5 mb-3'><small><a href='${more_url}' class='more-trending' data-hashtag='${h.hashtag}'>And ${h.threads_count - h.threads.length} more threads &rarr;</a></small></div>
`;
            }
        }

        $("#trending-hashtags").html(html);

        attachSerpEventHandlers("#trending-hashtags");

        $("#trending-hashtags a.more-trending").on("click", (e) => {
            const h = getBranchAttr($(e.target), 'data-hashtag');
            startSearchScroll(h);
            return false;
        });
    }

    function formatDate(d) {
        return d.toISOString().split('T')[0];
    }

    function formatTrendingHistoryHeader(type, date) {

        let html = "";

        let label = type;
        if (type == "videos") label = "video";
        if (type == "audios") label = "audio";

        const d = new Date(date);
        html += `
<h2 class='mt-3 mb-3'>Trending ${label} on ${d.toDateString()}</h2>
<div class='row mb-4'>
`;

        let previous = '';
        let next = '';

        const dn = new Date(d.getTime() + 24 * 3600 * 1000);
        const dp = new Date(d.getTime() - 24 * 3600 * 1000);
        if (dn < new Date().getTime())
            next = formatDate(dn);
        if (dp > new Date("2023-01-01").getTime())
            previous = formatDate(dp);

    if (previous)
      //       html += `
      //  <div class='col-auto'>
      //   <a class='btn btn-outline-primary previous' href='/trending/${type}/${previous}' data-date='${previous}'>&larr; Previous day</a>
      //  </div>
      // `;
      html += `
<div class='col-auto'>
 <a class='btn btn-outline-primary previous' href='index.html?viewParam=trending&viewValue=${type}&viewDate=${previous}' data-date='${previous}'>&larr; Previous day</a>
</div>
`;
    html += `
 <div class='col-auto'>
  <div class="input-group date">
   <input type="text" class="form-control" value='${date}'>
   <span class="input-group-addon"><i class="glyphicon glyphicon-th"></i></span>
  </div>
 </div>
`;
    if (next)
      //       html += `
      //  <div class='col'>
      //   <a class='btn btn-outline-primary next' href='/trending/${type}/${next}' data-date='${next}'>Next day &rarr;</a>
      //  </div>
      // `;
      html += `
<div class='col'>
 <a class='btn btn-outline-primary next' href='index.html?viewParam=trending&viewValue=${type}&viewDate=${next}' data-date='${next}'>Next day &rarr;</a>
</div>
`;
        html += `
</div>`;

        return html;
    }

    function formatTrendingHistoryFooter(type, date) {
        let html = "";
        const d = new Date(date);
        const monthNames = ["January", "February", "March", "April", "May", "June",
            "July", "August", "September", "October", "November", "December"];

        const max_month_date = new Date(Date.UTC(d.getFullYear (), d.getMonth () + 1, 0)).getDate();
        const md = new Date(
            Math.min(
                new Date(Date.UTC(d.getFullYear (), d.getMonth (), max_month_date)).getTime(),
                new Date().getTime ()));

        html += `
<div class='row mb-1'><div class='col-auto'>
 <b>${monthNames[d.getMonth()]}:</b>
</div><div class='col'>
`;
    for (let i = 1; i <= md.getDate(); i++) {
      const dt = formatDate(
        new Date(Date.UTC(d.getFullYear(), d.getMonth(), i))
      );
      const cur = i == d.getDate();

      //       html += ` <a class='btn btn-sm btn-outline-${
      //         cur ? "secondary" : "primary"
      //       } text-center dates'
      // data-date='${dt}' href='/trending/${type}/${dt}' style='width: 2.5em;'>${i}</a>`;
      //       if (i == 15) html += "<br>";
      //     }
      html += ` <a class='btn btn-sm btn-outline-${
        cur ? "secondary" : "primary"
      } text-center dates' 
data-date='${dt}' href='index.html?viewParam=trending&viewValue=${type}&viewDate=${dt}' style='width: 2.5em;'>${i}</a>`;
      if (i == 15) html += "<br>";
    }
    html += `
</div></div>`;

        const mm = new Date(
            Math.min(
                new Date(Date.UTC(d.getFullYear (), 11)).getTime(),
                new Date().getTime ()));
        console.log("mm", mm);

        html += `
<div class='row mb-1'><div class='col'>
<b>${d.getFullYear()}:</b>`;
    for (let i = 0; i <= mm.getMonth(); i++) {
      const dt = formatDate(new Date(Date.UTC(d.getFullYear(), i)));
      const cur = i == d.getMonth();
      //       html += ` <a class='btn btn-sm btn-outline-${
      //         cur ? "secondary" : "primary"
      //       } dates' data-date='${dt}'
      // href='/trending/${type}/${dt}'>${monthNames[i]}</a>`;
      //     }
      html += ` <a class='btn btn-sm btn-outline-${
        cur ? "secondary" : "primary"
      } dates' data-date='${dt}' 
href='index.html?viewParam=trending&viewValue=${type}&viewDate=${dt}'>${
        monthNames[i]
      }</a>`;
    }
    html += `
</div></div>`;

        return html;
    }

    function formatTrendingProfiles(r, date) {

        const history = !!date;

        let html = "";
        if (history)
            html += formatTrendingHistoryHeader("profiles", date);

        // simulate this to allow list-modal to work
        serp = [];

        for (const i in r.people)
        {
            const p = r.people[i];
            const more_url = formatPageUrl(p.pubkey, 0, '', 'nostr');

            serp.push(p.profile);

            html += formatPerson({
                p: p.profile,
                new_followers_count: p.followers_count,
                trending: true,
                rank: parseInt(i) + 1,
            });
        }

    if (history) {
      html += formatTrendingHistoryFooter("profiles", date);
    } else {
      const d = new Date(Date.now());
      const dt = formatDate(
        new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate() - 1))
      );
      // html += `<a href='/trending/profiles/${dt}'>See who was trending yesterday &rarr;</a>`;
      html += `<a href='index.html?viewParam=trending&viewValue=profiles&viewDate=${dt}'>See who was trending yesterday &rarr;</a>`;
    }

    function gotoDate(date) {
      const url = new URL(window.location);
      // url.pathname = "/trending/profiles/" + date;
      url.searchParams.set("viewDate", date);
      pushUrl(url);
      showTrending("profiles", date);
    }

        const cont = history ? "#results" : "#trending-profiles";
        $(cont).html(html);

        $(cont+' .input-group.date').datepicker({
            format: 'yyyy-mm-dd',
            startDate: '2023-01-01',
            endDate: formatDate(new Date()),
            defaultViewDate: date,
            autoclose: true,
        }).on('changeDate', function(e) {
            const o = e.date.getTimezoneOffset();
            const d = new Date(e.date.getTime() - e.date.getTimezoneOffset() * 60 * 1000);
            const date = formatDate(d);
            gotoDate(date);
        });

        attachSerpEventHandlers(cont);

        if (history) {
            $("#results a.previous, #results a.next, #results a.dates").on("click", (e) => {
                const date = getBranchAttr($(e.target), 'data-date');
                gotoDate(date);
                scrollTop();
                return false;
            });

        } else {
            $("#trending-people a.more-trending").on("click", (e) => {
                const pk = getBranchAttr($(e.target), 'data-pubkey');
                startSearchScroll(pk);
                return false;
            });

            $("#trending-people .following").on("click", (e) => {
                const pk = getBranchAttr($(e.target), 'data-pubkey');
                showFollows(pk, false);
            });

            $("#trending-people .followed").on("click", (e) => {
                const pk = getBranchAttr($(e.target), 'data-pubkey');
                showFollows(pk, true);
            });
        }

        /*    $(cont + " .follow-button").on("click", (e) => {
      if (window.nostr)
      {
	const pk = getBranchAttr($(e.target), 'data-pubkey');
	const relay = getBranchAttr($(e.target), 'data-relay');
	const following = getBranchAttr($(e.target), 'data-following');
	ensureFollowing(pk, relay, following == "true", e.target);
      }
      else
      {
	$("#login-modal").modal("show");
	//	openNostrProfile(e);
      }
    });
*/
    }

    function formatTrendingPosts(r, type, date) {

        console.log(r, type, date);
        const history = !!date;

        let html = "";
        if (history)
            html += formatTrendingHistoryHeader(type, date);

    for (const p of r[type]) {
      console.log(getNoteId(p.post.id));

      const more_url = "index.html?viewParam=" + getNoteId(p.post.id);
      html += formatEvent({ e: p.post, options: "no_padding" });

            for (const t of p.threads)
            {
                html += formatEvent({e: t, root: p.post, options: "no_padding"});
            }

            if (p.threads_count > p.threads.length)
            {
                html += `
<div class='ms-5 mb-3'><small><a href='${more_url}' class='more-trending' data-id='${p.post.id}'>And ${p.threads_count - p.threads.length} more replies &rarr;</a></small></div>
`;
            }
        }

    if (history) {
      html += formatTrendingHistoryFooter(type, date);
    } else {
      const d = new Date(Date.now());
      const dt = formatDate(
        new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate() - 1))
      );
      html += `<a href='index.html?viewParam=trending&viewValue=${type}&viewDate=${dt}'>See what was trending yesterday &rarr;</a>`;
    }

    function gotoDate(date) {
      const url = new URL(window.location);
      url.searchParams.set("viewValue", type);
      url.searchParams.set("viewDate", date);
      pushUrl(url);
      showTrending(type, date);
    }

        const cont = history ? "#results" : "#trending-"+type;

        $(cont).html(html);

        $(cont+' .input-group.date').datepicker({
            format: 'yyyy-mm-dd',
            startDate: '2023-01-01',
            endDate: formatDate(new Date()),
            defaultViewDate: date,
            autoclose: true,
        }).on('changeDate', function(e) {
            const o = e.date.getTimezoneOffset();
            const d = new Date(e.date.getTime() - e.date.getTimezoneOffset() * 60 * 1000);
            const date = formatDate(d);
            gotoDate(date);
        });

        attachSerpEventHandlers(cont);

        if (history) {
            $("#results a.previous, #results a.next, #results a.dates").on("click", (e) => {
                const date = getBranchAttr($(e.target), 'data-date');
                gotoDate(date);
                scrollTop();
                return false;
            });
        }
    }

    function formatTrendingZappedPosts(r) {

        console.log(r);
        let html = "";
        for (const p of r.zapped_posts)
        {
            if (!p.post || !p.post.id) continue;

      const more_url = "index.html?viewParam=" + getNoteId(p.post.id);
      html += formatEvent({ e: p.post, options: "no_padding" });

            for (const t of p.threads)
            {
                html += formatEvent({e: t, root: p.post, options: "no_padding"});
            }

            if (p.threads_count > p.threads.length)
            {
                html += `
<div class='ms-5 mb-3'><small><a href='${more_url}' class='more-trending' data-id='${p.post.id}'>And ${p.threads_count - p.threads.length} more replies &rarr;</a></small></div>
`;
            }
        }

        $("#trending-zapped_posts").html(html);

        attachSerpEventHandlers("#trending-zapped_posts");
    }

    function showTrending(type, date) {
        $("#search-spinner").removeClass("d-none");

        const tp = encodeURIComponent(type == "profiles" ? "people" : type);
        const dp = encodeURIComponent(date);
        return $.ajax({
            url: NOSTR_API + "method=trending&type=" + tp + (date ? "&date="+dp : ""),
        }).fail((x, r, e) => {
            $("#search-spinner").addClass("d-none");
            toastError("Request failed: "+e);
        }).done (r => {
            $("#search-spinner").addClass("d-none");

            setRelays(r.relays);

            if (type == "urls")
                formatTrendingUrls(r);
            else if (type == "hashtags")
                formatTrendingHashtags(r);
            else if (type == "profiles")
                formatTrendingProfiles(r, date);
            else if (type == "posts" || type == "images" || type == "videos"  || type == "audios")
                formatTrendingPosts(r, type, date);
            else if (type == "zapped_posts")
                formatTrendingZappedPosts(r);

            addOnNostr(updateNostrContactList);
            addOnNostr(updateNostrLists);
            updateNostrContactList();
            updateNostrLists();

            $("#greeting").addClass("d-none");
            if (date)
            {
                $("#results").removeClass("d-none");
            }
            else
            {
                $("#trending").removeClass("d-none");

                const triggerEl = document.querySelector('#trending a.nav-link[data-bs-target="#trending-'+type+'"]')
                bootstrap.Tab.getInstance(triggerEl).show() // Select tab by name
            }

            if (type == "urls")
                document.title = "Trending links on Nostr | Nostr.Band";
            else if (type == "hashtags")
                document.title = "Trending hashtags on Nostr | Nostr.Band";
            else if (type == "profiles")
                document.title = "Trending people on Nostr | Nostr.Band";
            else if (type == "posts")
                document.title = "Trending posts on Nostr | Nostr.Band";
            else if (type == "zapped_posts")
                document.title = "Trending zapped posts on Nostr | Nostr.Band";
            else if (type == "images")
                document.title = "Trending images on Nostr | Nostr.Band";
            setRobots(true);
        })
    }

    function openProfileOverview(e) {
        e.preventDefault();

        const pk = getBranchAttr($(e.target), 'data-pubkey');

    const url = new URL(window.location);
    url.searchParams.set("viewParam", getNpub(pk));
    url.searchParams.set("viewDate", "overview");
    url.search = "";
    pushUrl(url);

        getProfileOverview(pk);
        scrollTop();
    }

    function openEventOverview(e) {
        e.preventDefault();

        const eid = getBranchAttr($(e.target), 'data-eid');

    const url = new URL(window.location);
    url.searchParams.set("viewParam", getNoteId(eid));
    url.searchParams.set("viewDate", "overview");
    url.search = "";
    pushUrl(url);

        getEventOverview(eid);
        scrollTop();
    }

    function openZapsTo(e) {
        e.preventDefault();

        const pk = getBranchAttr($(e.target), 'data-pubkey');

    const url = new URL(window.location);
    url.searchParams.set("viewParam", getNpub(pk));
    url.searchParams.set("viewDate", "zaps-received");
    url.search = "";
    pushUrl(url);

        getZapsTo(pk);
        scrollTop();
    }

    function openZapsFor(e) {
        e.preventDefault();

        const eid = getBranchAttr($(e.target), 'data-eid');

    const url = new URL(window.location);
    url.searchParams.set("viewParam", getNoteId(eid));
    url.searchParams.set("sub_page", "zaps");
    url.search = "";
    pushUrl(url);

        getZapsFor(eid);
        scrollTop();
    }

    function openZapsVia(e) {
        e.preventDefault();

        const pk = getBranchAttr($(e.target), 'data-pubkey');

    const url = new URL(window.location);
    url.searchParams.set("viewParam", getNpub(pk));
    url.searchParams.set("viewDate", "zaps-processed");
    url.search = "";
    pushUrl(url);

        getZapsVia(pk);
        scrollTop();
    }

    function openZapsBy(e) {
        e.preventDefault();

        const pk = getBranchAttr($(e.target), 'data-pubkey');

    const url = new URL(window.location);
    url.searchParams.set("viewParam", getNpub(pk));
    url.searchParams.set("viewDate", "zaps-sent");
    url.search = "";
    pushUrl(url);

        getZapsBy(pk);
        scrollTop();
    }

    function eventToZap(e) {
        const z = e;
        for (const t of z.tags)
        {
            if (t?.length < 2)
                continue;

            if (t[0] == "bolt11")
            {
                try
                {
                    z.bolt11 = lightningPayReq.decode(t[1])
                }
                catch (e)
                {
                    console.log("bad zap bolt11", t[1]);
                    return null;
                }
            }
            else if (t[0] == "description")
            {
                try
                {
                    z.desc = JSON.parse(t[1]);
                }
                catch (e)
                {
                    console.log("bad zap description", t[1]);
                    return null;
                }
            }
            else if (t[0] == "p")
            {
                z.target_pubkey = t[1];
            }
            else if (t[0] == "e")
            {
                z.target_event_id = t[1];
            }
        }

        return z;
    }

    async function getZapsFor(eid) {
        getZaps(eid, "for");
    }

    async function getZapsTo(pk) {
        getZaps(pk, "to");
    }

    async function getZapsVia(pk) {
        getZaps(pk, "via");
    }

    async function getZapsBy(pk) {
        getZaps(pk, "by");
    }

    async function getZaps(pk_id, type) {
        $("#search-spinner").removeClass("d-none");

        const q = type + ":" + pk_id;

        $.ajax({
            url: NOSTR_API + "method=search&type=zaps&c=10&q=" + encodeURIComponent(q),
        }).fail((x, r, e) => {
            $("#search-spinner").addClass("d-none");
            toastError("Request failed: "+e);
        }).done (async function (rep) {
            $("#search-spinner").addClass("d-none");

            console.log("zaps", q, rep);

            let label = "";
            if (type == "to")
                label = "Latest zaps received";
            else if (type == "via")
                label = "Latest zaps processed";
            else if (type == "by")
                label = "Latest zaps sent";
            else if (type == "for")
                label = "Latest zaps received";
            label += ` (${rep.result_count})`;

            let html = type == "for"
                ? formatEventMenu(pk_id, label)
                : formatProfileMenu(pk_id, label)
            ;

            for (const z of rep.serp)
                html += formatZap(z, type);

            const more = formatPageUrl(type + ":" + pk_id, 0, "zaps");
            html += `<div class='mb-5'><a href="${more}">View all ${rep.result_count} zaps &rarr;</a></div>`;

            $("#serp").html(html);
            attachSerpEventHandlers("#serp");

            // FIXME attach event handlers
        });
    }

    async function getProfileOverview(pk)
    {
        $("#search-spinner").removeClass("d-none");

        $.ajax({
            url: PUBLIC_API + "/stats/profile/" + pk,
        }).fail((x, r, e) => {
            $("#search-spinner").addClass("d-none");
            toastError("Request failed: "+e);
        }).done (async function (rep) {
            $("#search-spinner").addClass("d-none");

            console.log("profile stats", pk, rep);

        const r = rep.stats[pk];
        const url = new URL(window.location);
        url.searchParams.set("viewParam", getNpub(pk));
        pushUrl(url);
        console.log(url, url.searchParams);
        const npub = `index.html?viewParam=${getNpub(pk)}`;

            let html = `
<div data-pubkey='${pk}'>
<h2>Overview</h2>

<div class="row">

<div class="col-12 mt-2 mb-1">
<small class='text-muted'>Need these numbers in your client? Try our <a href='https://api.nostr.band'>API</a>.</small>
</div>

<div class="col-12 mt-3 mb-1">
<h4>Published by profile:</h4>
</div>

<div class="col-12 border-bottom mb-2 position-relative">
<div class='stats'>Posts & replies: <b>${r.pub_note_count || 0}</b></div>
<span class='text-muted'>Total number of posts published by this profile.</span>
<a href='${npub}' class='stretched-link'>View</a>
</div>
<div class="col-12 border-bottom mb-2 position-relative">
<div class='stats'>Posts: <b>${r.pub_post_count || 0}</b></div>
<span class='text-muted'>Number of posts published by this profile</span>
</div>
<div class="col-12 border-bottom mb-2 position-relative">
<div class='stats'>Replies: <b>${r.pub_reply_count || 0}</b></div>
<span class='text-muted'>Number of replies published by this profile</span>
</div>
<div class="col-12 border-bottom mb-2 position-relative">
<div class='stats'>Likes: <b>${r.pub_reaction_count || 0}</b></div>
<span class='text-muted'>Number of likes published by this profile</span>
</div>
<div class="col-12 border-bottom mb-2 position-relative">
<div class='stats'>Reports: <b>${r.pub_report_count || 0}</b></div>
<span class='text-muted'>Number of reports published by this profile</span>
</div>
<div class="col-12 border-bottom mb-2 position-relative">
<div class='stats'>Mentioned events: <b>${r.pub_note_ref_event_count || 0}</b></div>
<span class='text-muted'>Number of events mentioned by posts of this profile</span>
</div>
<div class="col-12 border-bottom mb-2 position-relative">
<div class='stats'>Mentioned profiles: <b>${r.pub_note_ref_pubkey_count || 0}</b></div>
<span class='text-muted'>Number of profiles mentioned by posts of this profile</span>
</div>
<div class="col-12 border-bottom mb-2 position-relative">
<div class='stats'>Reposted events: <b>${r.pub_repost_ref_event_count || 0}</b></div>
<span class='text-muted'>Number of events reposted by this profile</span>
</div>
<div class="col-12 border-bottom mb-2 position-relative">
<div class='stats'>Reposted profiles: <b>${r.pub_repost_ref_pubkey_count || 0}</b></div>
<span class='text-muted'>Number of profiles reposted by this profile</span>
</div>
<div class="col-12 border-bottom mb-2 position-relative">
<div class='stats'>Liked events: <b>${r.pub_reaction_ref_event_count || 0}</b></div>
<span class='text-muted'>Number of events liked by this profile</span>
</div>
<div class="col-12 border-bottom mb-2 position-relative">
<div class='stats'>Liked profiles: <b>${r.pub_reaction_ref_pubkey_count || 0}</b></div>
<span class='text-muted'>Number of profiles liked by this profile</span>
</div>
<div class="col-12 border-bottom mb-2 position-relative">
<div class='stats'>Reported events: <b>${r.pub_report_ref_event_count || 0}</b></div>
<span class='text-muted'>Number of events reported by this profile</span>
</div>
<div class="col-12 border-bottom mb-2 position-relative">
<div class='stats'>Reported profiles: <b>${r.pub_report_ref_pubkey_count || 0}</b></div>
<span class='text-muted'>Number of profiles reported by this profile</span>
</div>

<div class="col-12 mt-3 mb-1">
<h4>References to profile:</h4>
<small class='text-muted'>All numbers include this profile's self-referencing events.</small>
</div>

<div class="col-12 border-bottom mb-2 position-relative">
<div class='stats'>Replies: <b>${r.reply_count || 0}</b></div>
<span class='text-muted'>Number of replies to posts of this profile.</span>
</div>
<div class="col-12 border-bottom mb-2 position-relative">
<div class='stats'>Replying profiles: <b>${r.reply_pubkey_count || 0}</b></div>
<span class='text-muted'>Number of profiles that reply to this profile.</span>
</div>
<div class="col-12 border-bottom mb-2 position-relative">
<div class='stats'>Reposts: <b>${r.repost_count || 0}</b></div>
<span class='text-muted'>Number of reposts of events of this profiles.</span>
</div>
<div class="col-12 border-bottom mb-2 position-relative">
<div class='stats'>Reposting profiles: <b>${r.repost_pubkey_count || 0}</b></div>
<span class='text-muted'>Number of profiles that repost events of this profile.</span>
</div>
<div class="col-12 border-bottom mb-2 position-relative">
<div class='stats'>Likes: <b>${r.reaction_count || 0}</b></div>
<span class='text-muted'>Number of likes of events of this profile.</span>
</div>
<div class="col-12 border-bottom mb-2 position-relative">
<div class='stats'>Liking profiles: <b>${r.reaction_pubkey_count || 0}</b></div>
<span class='text-muted'>Number of profiles that like events of this profile.</span>
</div>
<div class="col-12 border-bottom mb-2 position-relative">
<div class='stats'>Reports: <b>${r.report_count || 0}</b></div>
<span class='text-muted'>Number of reports of events of this profile.</span>
</div>
<div class="col-12 border-bottom mb-2 position-relative">
<div class='stats'>Reporting profiles: <b>${r.report_pubkey_count || 0}</b></div>
<span class='text-muted'>Number of profiles that report events of this profile.</span>
</div>

<div class="col-12 mt-3 mb-1">
<h4>Zaps received:</h4>
</div>

<div class="col-12 border-bottom mb-2 position-relative">
<div class='stats'>Number of zaps: <b>${r?.zaps_received?.count || 0}</b></div>
<span class='text-muted'>Number of zaps received by this profile.</span>
<a href='${npub}&sub_page=zaps-received' class='stretched-link open-zaps-to'>View</a>
</div>
`
            if (r.zaps_received)
            {
                html += `
<div class="col-12 border-bottom mb-2 position-relative">
<div class='stats'>Number of zappers: <b>${r.zaps_received.zapper_count}</b></div>
<span class='text-muted'>Number of profiles that zapped this profile.</span>
</div>
<div class="col-12 border-bottom mb-2 position-relative">
<div class='stats'>Total amount of zaps: <b>${r.zaps_received.msats / 1000} sats</b></div>
<span class='text-muted'>Total amount of zaps received by this profile.</span>
</div>
<div class="col-12 border-bottom mb-2 position-relative">
<div class='stats'>Min amount of zaps: <b>${r.zaps_received.min_msats / 1000} sats</b></div>
<span class='text-muted'>Minimal amount of zaps received by this profile.</span>
</div>
<div class="col-12 border-bottom mb-2 position-relative">
<div class='stats'>Max amount of zaps: <b>${r.zaps_received.max_msats / 1000} sats</b></div>
<span class='text-muted'>Maximal amount of zaps received by this profile.</span>
</div>
<div class="col-12 border-bottom mb-2 position-relative">
<div class='stats'>Average amount of zaps: <b>${r.zaps_received.avg_msats / 1000} sats</b></div>
<span class='text-muted'>Average amount of zaps received by this profile.</span>
</div>
<div class="col-12 border-bottom mb-2 position-relative">
<div class='stats'>Median amount of zaps: <b>${r.zaps_received.median_msats / 1000} sats</b></div>
<span class='text-muted'>Median amount of zaps received by this profile.</span>
</div>
<div class="col-12 border-bottom mb-2 position-relative">
<div class='stats'>Number of providers: <b>${r.zaps_received.provider_count}</b></div>
<span class='text-muted'>Number of providers that processed zaps received by this profile.</span>
</div>
`;
            }

            html += `
<div class="col-12 mt-3 mb-1">
<h4>Zaps sent:</h4>
</div>

<div class="col-12 border-bottom mb-2 position-relative">
<div class='stats'>Number of zaps: <b>${r?.zaps_sent?.count || 0}</b></div>
<span class='text-muted'>Number of zaps sent by this profile.</span>
<a href='${npub}&sub_page=zaps-sent' class='stretched-link open-zaps-by'>View</a>
</div>
`
            if (r.zaps_sent)
            {
                html += `
<div class="col-12 border-bottom mb-2 position-relative">
<div class='stats'>Number of zapped events: <b>${r.zaps_sent.target_event_count || 0}</b></div>
<span class='text-muted'>Number of events that were zapped by this profile.</span>
</div>
<div class="col-12 border-bottom mb-2 position-relative">
<div class='stats'>Number of zapped profiles: <b>${r.zaps_sent.target_pubkey_count}</b></div>
<span class='text-muted'>Number of profiles that received zaps from this profile.</span>
</div>
<div class="col-12 border-bottom mb-2 position-relative">
<div class='stats'>Total amount of zaps: <b>${r.zaps_sent.msats / 1000} sats</b></div>
<span class='text-muted'>Total amount of zaps sent by this profile.</span>
</div>
<div class="col-12 border-bottom mb-2 position-relative">
<div class='stats'>Min amount of zaps: <b>${r.zaps_sent.min_msats / 1000} sats</b></div>
<span class='text-muted'>Minimal amount of zaps sent by this profile.</span>
</div>
<div class="col-12 border-bottom mb-2 position-relative">
<div class='stats'>Max amount of zaps: <b>${r.zaps_sent.max_msats / 1000} sats</b></div>
<span class='text-muted'>Maximal amount of zaps sent by this profile.</span>
</div>
<div class="col-12 border-bottom mb-2 position-relative">
<div class='stats'>Average amount of zaps: <b>${r.zaps_sent.avg_msats / 1000} sats</b></div>
<span class='text-muted'>Average amount of zaps sent by this profile.</span>
</div>
<div class="col-12 border-bottom mb-2 position-relative">
<div class='stats'>Median amount of zaps: <b>${r.zaps_sent.median_msats / 1000} sats</b></div>
<span class='text-muted'>Median amount of zaps sent by this profile.</span>
</div>
<div class="col-12 border-bottom mb-2 position-relative">
<div class='stats'>Number of providers: <b>${r.zaps_sent.provider_count}</b></div>
<span class='text-muted'>Number of providers that processed zaps sent by this profile.</span>
</div>
`;
            }

            html += `
<div class="col-12 mt-3 mb-1">
<h4>Zaps processed:</h4>
</div>

<div class="col-12 border-bottom mb-2 position-relative">
<div class='stats'>Number of zaps: <b>${r?.zaps_processed?.count || 0}</b></div>
<span class='text-muted'>Number of zaps processed by this profile.</span>
<a href='${npub}&sub_page=zaps-processed' class='stretched-link open-zaps-via'>View</a>
</div>
`
            if (r.zaps_processed)
            {
                html += `
<div class="col-12 border-bottom mb-2 position-relative">
<div class='stats'>Number of zapped events: <b>${r.zaps_processed.target_event_count || 0}</b></div>
<span class='text-muted'>Number of events that received zaps processed by this profile.</span>
</div>
<div class="col-12 border-bottom mb-2 position-relative">
<div class='stats'>Number of zapped profiles: <b>${r.zaps_processed.target_pubkey_count}</b></div>
<span class='text-muted'>Number of profiles that received zaps processed by this profile.</span>
</div>
<div class="col-12 border-bottom mb-2 position-relative">
<div class='stats'>Total amount of zaps: <b>${r.zaps_processed.msats / 1000} sats</b></div>
<span class='text-muted'>Total amount of zaps processed by this profile.</span>
</div>
<div class="col-12 border-bottom mb-2 position-relative">
<div class='stats'>Min amount of zaps: <b>${r.zaps_processed.min_msats / 1000} sats</b></div>
<span class='text-muted'>Minimal amount of zaps processed by this profile.</span>
</div>
<div class="col-12 border-bottom mb-2 position-relative">
<div class='stats'>Max amount of zaps: <b>${r.zaps_processed.max_msats / 1000} sats</b></div>
<span class='text-muted'>Maximal amount of zaps processed by this profile.</span>
</div>
<div class="col-12 border-bottom mb-2 position-relative">
<div class='stats'>Average amount of zaps: <b>${r.zaps_processed.avg_msats / 1000} sats</b></div>
<span class='text-muted'>Average amount of zaps processed by this profile.</span>
</div>
<div class="col-12 border-bottom mb-2 position-relative">
<div class='stats'>Median amount of zaps: <b>${r.zaps_processed.median_msats / 1000} sats</b></div>
<span class='text-muted'>Median amount of zaps processed by this profile.</span>
</div>
`;
            }


            html += `
</div>
</div>
`;

            $("#serp").html(html);

            attachSerpEventHandlers("#serp");
        });
    }

    async function getEventOverview(eid)
    {
        $("#search-spinner").removeClass("d-none");

        $.ajax({
            url: PUBLIC_API + "/stats/event/" + eid,
        }).fail((x, r, e) => {
            $("#search-spinner").addClass("d-none");
            toastError("Request failed: "+e);
        }).done (async function (rep) {
            $("#search-spinner").addClass("d-none");

            console.log("event stats", eid, rep);

            const r = rep.stats[eid];

        const note = `index.html?viewParam=${getNoteId(eid)}`;

            let html = `
<div data-eid='${eid}'>
<h2>Overview</h2>

<div class="row">

<div class="col-12 mt-2 mb-1">
<small class='text-muted'>Need these numbers in your client? Try our <a href='https://api.nostr.band'>API</a>.</small>
</div>

<div class="col-12 mt-3 mb-1">
<h4>References to event:</h4>
</div>

<div class="col-12 border-bottom mb-2 position-relative">
<div class='stats'>Replies: <b>${r.reply_count || 0}</b></div>
<span class='text-muted'>Number of replies to this post.</span>
<a href='${note}' class='stretched-link'>View</a>
</div>
<div class="col-12 border-bottom mb-2 position-relative">
<div class='stats'>Replying profiles: <b>${r.reply_pubkey_count || 0}</b></div>
<span class='text-muted'>Number of profiles that reply to this post.</span>
</div>
<div class="col-12 border-bottom mb-2 position-relative">
<div class='stats'>Reposts: <b>${r.repost_count || 0}</b></div>
<span class='text-muted'>Number of reposts of this post.</span>
</div>
<div class="col-12 border-bottom mb-2 position-relative">
<div class='stats'>Reposting profiles: <b>${r.repost_pubkey_count || 0}</b></div>
<span class='text-muted'>Number of profiles that reposted this post.</span>
</div>
<div class="col-12 border-bottom mb-2 position-relative">
<div class='stats'>Likes: <b>${r.reaction_count || 0}</b></div>
<span class='text-muted'>Number of likes of this post.</span>
</div>
<div class="col-12 border-bottom mb-2 position-relative">
<div class='stats'>Liking profiles: <b>${r.reaction_pubkey_count || 0}</b></div>
<span class='text-muted'>Number of profiles that like this post.</span>
</div>
<div class="col-12 border-bottom mb-2 position-relative">
<div class='stats'>Reports: <b>${r.report_count || 0}</b></div>
<span class='text-muted'>Number of reports of this post.</span>
</div>
<div class="col-12 border-bottom mb-2 position-relative">
<div class='stats'>Reporting profiles: <b>${r.report_pubkey_count || 0}</b></div>
<span class='text-muted'>Number of profiles that report this post.</span>
</div>

<div class="col-12 mt-3 mb-1">
<h4>Zaps received:</h4>
</div>

<div class="col-12 border-bottom mb-2 position-relative">
<div class='stats'>Number of zaps: <b>${r?.zaps?.count || 0}</b></div>
<span class='text-muted'>Number of zaps received by this post.</span>
<a href='${note}&sub_page=zaps' class='stretched-link'>View</a>
</div>
`
            if (r.zaps)
            {
                html += `
<div class="col-12 border-bottom mb-2 position-relative">
<div class='stats'>Number of zappers: <b>${r.zaps.zapper_count}</b></div>
<span class='text-muted'>Number of profiles that zapped this post.</span>
</div>
<div class="col-12 border-bottom mb-2 position-relative">
<div class='stats'>Total amount of zaps: <b>${r.zaps.msats / 1000} sats</b></div>
<span class='text-muted'>Total amount of zaps received by this post.</span>
</div>
<div class="col-12 border-bottom mb-2 position-relative">
<div class='stats'>Min amount of zaps: <b>${r.zaps.min_msats / 1000} sats</b></div>
<span class='text-muted'>Minimal amount of zaps received by this post.</span>
</div>
<div class="col-12 border-bottom mb-2 position-relative">
<div class='stats'>Max amount of zaps: <b>${r.zaps.max_msats / 1000} sats</b></div>
<span class='text-muted'>Maximal amount of zaps received by this post.</span>
</div>
<div class="col-12 border-bottom mb-2 position-relative">
<div class='stats'>Average amount of zaps: <b>${r.zaps.avg_msats / 1000} sats</b></div>
<span class='text-muted'>Average amount of zaps received by this post.</span>
</div>
<div class="col-12 border-bottom mb-2 position-relative">
<div class='stats'>Median amount of zaps: <b>${r.zaps.median_msats / 1000} sats</b></div>
<span class='text-muted'>Median amount of zaps received by this post.</span>
</div>
<div class="col-12 border-bottom mb-2 position-relative">
<div class='stats'>Number of providers: <b>${r.zaps.provider_count}</b></div>
<span class='text-muted'>Number of providers that processed zaps received by this post.</span>
</div>
`;
            }

            html += `
</div>
</div>
`;

            $("#serp").html(html);

            attachSerpEventHandlers("#serp");
        });
    }

    async function getZapsOld(pk, type) {
        $("#search-spinner").removeClass("d-none");

        // FIXME switch to RELAY when trust ranks starts counting zaps
        // so that zap providers start having non-zero rank
        const relay = RELAY_ALL;

        const req = {
            kinds:[9735],
            limit: 100,
        }

        if (type == "to")
            req["#p"] = [pk];
        else if (type == "via")
            req["authors"] = [pk];

        const events = await getNostrEvents(req, relay);
//	console.log(events);

        const zaps = [];
        for (const e of events)
        {
            const z = eventToZap(e);
            if (z)
                zaps.push(z);
        }

        if (!zaps)
            return;

        const pubkeys = new Set();
        const event_ids = new Set();
        for (const z of zaps)
        {
            pubkeys.add(z.pubkey);
            pubkeys.add(z.desc.pubkey);
            pubkeys.add(z.target_pubkey);
            if (z.target_event_id)
                event_ids.add(z.target_event_id);
        }
//	console.log("event_ids", event_ids);

        const profiles = await getNostrEvents({
            kinds: [0],
            authors: [...pubkeys.values()],
            limit: pubkeys.size,
        }, relay);
//	console.log("profiles", profiles);
        const profile_map = {};
        for (const p of profiles)
            profile_map[p.pubkey] = p;

        const targets = await getNostrEvents({
            ids: [...event_ids.values()],
            limit: event_ids.size,
        }, relay);
        const target_map = {};
        for (const t of targets)
            target_map[t.id] = t;

        for (const z of zaps) {
            z.zapper = profile_map[z.desc.pubkey];
            z.provider = profile_map[z.pubkey];
            z.target_profile = profile_map[z.target_pubkey];
            if (z.target_event_id)
                z.target_event = target_map[z.target_event_id];
        }
//	console.log(zaps);

        let label = "";
        if (type == "to")
            label = "Latest zaps received";
        else if (type == "via")
            label = "Latest zaps processed";

//	const btns = formatProfileSerpButtons(pk);
//	let html = `<h2>
//${label} (${zaps.length}${zaps.length >= 100 ? "+" : ""}): ${btns}
//</h2>
//`;
        for (const z of zaps)
            html += formatZap(z, type);

        $("#serp").html(html);
        $("#search-spinner").addClass("d-none");
    }

    function toggleScanRelays(e) {

        if (scanning_relays)
        {
            $("#scan-relays").html("Scan relays");
            $("#scan-relays-status").html("Scan stopped.");
            scanning_relays = false;
            return;
        }

        $("#scan-relays").html("Stop");
        scanning_relays = true;

        const q = getBranchAttr($(e.target), 'data-query');

        $("#search-spinner").removeClass("d-none");
        $.ajax({
            url: NOSTR_API + "method=relays",
        }).fail((x, r, e) => {
            $("#search-spinner").addClass("d-none");
            toastError("Request failed: "+e);
        }).done (async function (rep) {
            $("#search-spinner").addClass("d-none");

            let note = !q.startsWith("npub1");
            let npub = !q.startsWith("note1");
            let hex = q;
            if (q.startsWith("npub1") || q.startsWith("note1"))
            {
                const r = tools.nip19.decode(q);
                console.log(r);
                note = r.type == "note";
                npub = r.type == "npub";
                if (note || npub)
                    hex = r.data;
            }

            let html = "";
            for (const r of rep.relays)
            {
                if (!scanning_relays)
                    break;

                const status = `
Scanning ${r.u}...
`;
                $("#scan-relays-status").html(status);

                try
                {
                    if (note)
                    {
                        const sub = {
                            ids: [hex],
                            limit: 1
                        };
                        const notes = await getNostrEvents(sub, r.u);
                        console.log("notes", notes.length, "relay", r.u);
                        for (const n of notes)
                        {
                            const nevent = tools.nip19.neventEncode({id: n.id, relays: [r.u]});
                            html += `
<div>Found <a target='_blank' href='https://nostr.guru/${nevent}'>event</a> on ${r.u}</div>
`;
                            $("#scan-relays-results").html(html);
                        }
                    }
                    if (npub)
                    {
                        const sub = {
                            authors: [hex],
                            limit: 1
                        };
                        const author_notes = await getNostrEvents(sub, r.u);
                        console.log("author_notes", author_notes.length, "relay", r.u);
                        for (const n of author_notes)
                        {
                            const nevent = tools.nip19.neventEncode({id: n.id, relays: [r.u]});
                            html += `
<div>Found <a target='_blank' href='https://nostr.guru/${nevent}'>event</a> by pubkey on ${r.u}</div>
`;
                            $("#scan-relays-results").html(html);
                        }
                    }
                    if (npub)
                    {
                        const sub = {
                            authors: [hex],
                            kinds: [0],
                            limit: 1
                        };
                        const profiles = await getNostrEvents(sub, r.u);
                        console.log("profiles", profiles.length, "relay", r.u);
                        for (const n of profiles)
                        {
                            html += `
<div>Found <a target='_blank' href='https://nostr.guru/${nevent}'>profile</a> on ${r.u}</div>
`;
                        }
                    }
                }
                catch (e)
                {
                    console.log("failed to scan", r.u, e);
                }
                closeSocket(r.u);
            }
        });
    }

    function formatAdvancedQuery() {
        const q_and = $("#a-and").val().trim();
//	const q_hashtags = $("#a-hashtags").val().trim();
        const q_by = $("#a-by").val().trim();
        const q_following = $("#a-following").val().trim();
//	const q_except = $("#a-except").val().trim();
        const q_lang = $("#a-lang").val().trim();
        const q_lna = $("#a-lna").val().trim();
        const q_nip05 = $("#a-nip05").val().trim();
        const q_spam = $("#a-spam").is(":checked");

        /*	let ht = "";
	for (let h of q_hashtags.split(" "))
	{
	    h.trim();
	    if (!h)
		continue;

	    if (h.substring(0,1) != "#")
		h = "#" + h;
	    if (ht)
		ht += " ";
	    ht += h;
	}
	let except = "";
	for (let e of q_except.split(" "))
	{
	    e.trim();
	    if (!e)
		continue;

	    if (e.substring(0,1) != "-")
		e = "-" + e;
	    if (except)
		except += " ";
	    except += e;
	}
*/

        let q = "";
        if (q_and)
            q += (q ? " " : "") + q_and;
//	if (ht)
//	    q += (q ? " " : "") + ht;
//	if (except)
//	    q += (q ? " " : "") + except;
        if (q_by)
            q += (q ? " " : "") + "by:"+q_by;
        if (q_following)
            q += (q ? " " : "") + "following:"+q_following;
        if (q_lang)
            q += (q ? " " : "") + "lang:"+q_lang;
        if (q_lna)
            q += (q ? " " : "") + "lna:"+q_lna;
        if (q_nip05)
            q += (q ? " " : "") + "nip05:"+q_nip05;
        if (q && q_spam)
            q += " -filter:spam";

        $("#a-q").val(q);
    }

    const toast_error = new bootstrap.Toast($("#toast-error")[0]);
    function toastError(e) {
        $("#toast-error .toast-body").html(e);
        toast_error.show ();
    }

    const toast_ok = new bootstrap.Toast($("#toast-ok")[0]);
    function toastOk(header, text) {
        $("#toast-ok .toast-header .me-auto").html(header);
        $("#toast-ok .toast-body").html(text);
        toast_ok.show ();
    }

    // from webln.guide
    async function detectWebLNProvider(timeoutParam) {
        const timeout = timeoutParam ?? 3000;
        const interval = 100;
        let handled = false;

        return new Promise((resolve) => {
            if (window.webln) {
                handleWebLN();
            } else {
                document.addEventListener("webln:ready", handleWebLN, { once: true });

                let i = 0;
                const checkInterval = setInterval(function() {
                    if (window.webln || i >= timeout/interval) {
                        handleWebLN();
                        clearInterval(checkInterval);
                    }
                    i++;
                }, interval);
            }

            function handleWebLN() {
                if (handled) {
                    return;
                }
                handled = true;

                document.removeEventListener("webln:ready", handleWebLN);

                if (window.webln) {
                    resolve(window.webln);
                } else {
                    resolve(null);
                }
            }
        });
    };

    $("#search").on("submit", function (e) {
        e.preventDefault();

        const q = $("#q").val().trim();
        if (!q)
        {
            document.location = "/";
            //	    toastError("Specify query");
            return;
        }
        setQuery(q);

        let type = $("#object-type").attr("data-type");
        if (type == "all")
            type = ""; // default
        let sort = getBranchAttr($('input[name="sort"]:checked'), "data-sort");
        if (sort == "recent")
            sort = ""; // default
        let scope = getBranchAttr($('input[name="scope"]:checked'), "data-scope");
        if (scope == "global")
            scope = ""; // default

        pushSearchState (q, 0, type, sort, scope);

        return false;
    });

    addEventListener('popstate', e => {
        updateParamsState();
    });

    function selectClient(client) {
        // console.log("select client", client);
        if (!client)
        {
            $("#chosen-client").attr("data-client", "");
            $("#chosen-client").html("Select your client...");
            $("#client-open").attr("disabled", true);
            return;
        }

        const content = $("#select-client-dropdown .dropdown-item[data-client=\""+client+"\"]").html ();
        if (!content)
            return;

        $("#chosen-client").html(content);
        $("#chosen-client").attr("data-client", client);
        $("#client-open").attr("disabled", false);
    }

    $("#select-client-dropdown .dropdown-item").on("click", (e) => {
        const client = getBranchAttr($(e.target), "data-client");
        const remember = $("#remember-client").is(":checked");
        selectClient(client, remember);
    });

    $("#nostr-client-modal").on('shown.bs.modal', e => {
        const client = localGet("chosen-client");
        $("#remember-client").attr("checked", !!client);
    });

    $("#client-open").on("click", (e) => {
        const client = $("#chosen-client").attr("data-client");
        const remember = $("#remember-client").is(":checked");
        console.log("client", client, "remember", remember);

        const target = $("#nostr-client-modal").attr("data-target");
        const type = $("#nostr-client-modal").attr("data-type");
        const relay = "wss://relay.nostr.band";
        console.log("target", target, "type", type);

        let url = "";
        if (type == 'profile')
        {
            const npub = tools.nip19.npubEncode(target);
            const nprofile = tools.nip19.nprofileEncode({pubkey: target, relays: [relay]});

            if (client == "damus")
                url = `damus:${npub}`;
            else if (client == "amethyst")
                url = `nostr:${nprofile}`;
            else if (client == "nostrgram")
                url = `https://nostrgram.co/#profile:allMedia:${target}`;
            else if (client == "snort")
                url = `https://snort.social/p/${npub}`;
            else if (client == "iris")
                url = `https://iris.to/#/profile/${npub}`;
            else if (client == "astral")
                url = `https://astral.ninja/${npub}`;
            else if (client == "coracle")
                url = `https://coracle.social/${nprofile}`;
            else if (client == "guru")
                url = `https://www.nostr.guru/p/${target}`;
            else if (client == "satellite")
                url = `https://satellite.earth/@${npub}`;
            else if (client == "primal")
                url = `https://primal.net/profile/${npub}`;
                //	    else if (client == "plebstr")
            //	        url = `nostr:${npub}`;
            else if (client == "other-nprofile")
                url = `nostr:${nprofile}`;
            else
                url = `nostr:${npub}`;
        }
        else
        {
            //	    const coracle = btoa(JSON.stringify({note:{id:target}}));
            const note = tools.nip19.noteEncode(target);
            const nevent = tools.nip19.neventEncode({id: target, relays: [relay]});

            if (client == "damus")
                url = `damus:${note}`;
            else if (client == "nostrgram")
                url = `https://nostrgram.co/#thread:${target}:${target}`;
            else if (client == "snort")
                url = `https://snort.social/e/${note}`;
            else if (client == "iris")
                url = `https://iris.to/#/post/${note}`;
            else if (client == "astral")
                url = `https://astral.ninja/${note}`;
            else if (client == "coracle")
                url = `https://coracle.social/${nevent}`;
            else if (client == "guru")
                url = `https://www.nostr.guru/e/${target}`;
            else if (client == "satellite")
                url = `https://satellite.earth/thread/${note}`;
            else if (client == "primal")
                url = `https://primal.net/thread/${note}`;
            else if (client == "other-nprofile")
                url = `nostr:${nevent}`;
                //	    else if (client == "plebstr")
                //		url = `nostr:${note}`;
                //	    else if (client == "amethyst")
            //		url = `nostr:${note}`;
            else
                url = `nostr:${note}`;
        }
        window.open (url, '_blank');

        if (remember)
            localSet("chosen-client", client);
        else
            selectClient(localGet("chosen-client"));

        $("#nostr-client-modal").modal("hide");
    });

    $("#nostr-client-modal").on('hidden.bs.modal', e => {
        if ($("#nostr-client-modal").attr("data-follows") == "true")
            $("#follows-modal").modal("show");

        selectClient(localGet("chosen-client"));
    });

    $("#send-feedback-button").on("click", () => {
        sendFeedback ();
    });

    $("#trending a.nav-link").on("click", (e) => {
        const type = getBranchAttr($(e.target), "data-trending");

        const url = new URL(window.location);
        if (type != "profiles")
            url.searchParams.set('trending', type);
        else
            url.searchParams.delete('trending');
        pushUrl(url);

        showTrending(type);
    });

  $("#button-advanced-search-open").on("click", (e) => {
    e.preventDefault();

        const url = new URL(window.location);
        url.searchParams.set('advanced', 'true');
        pushUrl(url);

        $("#search").addClass("d-none");
        $("#advanced-search").removeClass("d-none");
        $(".as").removeClass("d-none");
        $(".sb").addClass("d-none");
        return false;
    });

    $("#button-advanced-search, #button-search-bot-preview").on("click", () => {

        const params = deParams();

        const q = $("#a-q").val();
        pushSearchState (q, 0, '', '', '');

        // enabling can only be done after a user click, so here it is
        //enableNostr().then(updateNostrContactList);

        if (params.advanced && (params.advanced == "sb" || params.advanced == "rss"))
        {
            // noop
        }
        else
        {
            setQuery(q);
            $("#search").removeClass("d-none");
            $("#advanced-search").addClass("d-none");
        }
        return false;
    });

    $("#button-advanced-search-cancel").on("click", () => {
        $("#search").removeClass("d-none");
        $("#advanced-search").addClass("d-none");

        const url = new URL(window.location);
        url.searchParams.delete('advanced');
        pushUrl(url);
    });

    $("#button-search-bot-cancel").on("click", () => {
        $("#search").removeClass("d-none");
        $("#advanced-search").addClass("d-none");

        const url = new URL(window.location);
        url.searchParams.delete('advanced');
        pushUrl(url);
    });

    $("#create-search-bot").on("click", () => {
        const as = $("#create-search-bot").attr ("data-as");
        const q = $("#a-q").val();
        const eq = encodeURIComponent(q);
        if (as == "sb")
            document.location.href = "https://sb.nostr.band/?create="+eq;
        else if (as == "rss")
            document.location.href = "https://rss.nostr.band/?create="+eq;
    });

    $(".a-s").on("keyup", (e) => {
        formatAdvancedQuery();
    });

    $(".a-s").on("change", (e) => {
        formatAdvancedQuery();
    });

    function localGet(key)
    {
        try
        {
            if (localStorage)
                return localStorage.getItem(key);
            else
                return sessionStorage.getItem(key);
        }
        catch (e)
        {
            return null;
        }
    }

    function localSet(key, value)
    {
        try
        {
            if (localStorage)
                localStorage.setItem(key, value);
            else
                sessionStorage.setItem(key, value);
        }
        catch (e)
        {}
    }

    function applySort(sort)
    {
        localSet("sort", sort);

        setTimeout(function () {
            const q = $("#q").val().trim();
            if (!q)
                return;

            $("#search").trigger("submit");
        }, 0);
    }

    $("#sort-buttons input[type=radio]").on("change", (e) => {
        const sort = getBranchAttr($(e.target), "data-sort");
//	console.log("sort", sort);
        if (sort.startsWith("popular"))
        {
            $("#sort-popular-group button.dropdown-toggle").removeClass("btn-outline-secondary");
            $("#sort-popular-group button.dropdown-toggle").addClass("btn-secondary");
            $("#sort-personalized-group button.dropdown-toggle").addClass("btn-outline-secondary");
            $("#sort-personalized-group button.dropdown-toggle").removeClass("btn-secondary");
            localSet("sort-popular", sort);
        }
        else if (sort.startsWith("personalized"))
        {
            $("#sort-popular-group button.dropdown-toggle").addClass("btn-outline-secondary");
            $("#sort-popular-group button.dropdown-toggle").removeClass("btn-secondary");
            $("#sort-personalized-group button.dropdown-toggle").removeClass("btn-outline-secondary");
            $("#sort-personalized-group button.dropdown-toggle").addClass("btn-secondary");
            localSet("sort-personalized", sort);
        }
        else
        {
            $("#sort-popular-group button.dropdown-toggle").addClass("btn-outline-secondary");
            $("#sort-popular-group button.dropdown-toggle").removeClass("btn-secondary");
            $("#sort-personalized-group button.dropdown-toggle").addClass("btn-outline-secondary");
            $("#sort-personalized-group button.dropdown-toggle").removeClass("btn-secondary");
        }

//	console.log("set", sort);

        const ready = getBranchAttr($(e.target), "data-ready") == "true";
        if (ready)
        {
            applySort(sort);
        }
    });

//    $("#sort-buttons .dropdown-toggle").on("click", (e) => {
//	const sort_type = getBranchAttr($(e.target), "data-sort-type");
//	$("#sort-"+sort_type).trigger("click");
//    });

    function setSort(e)
    {
        const sort_type = getBranchAttr($(e), "data-sort-type");
        const sort = getBranchAttr($(e), "data-sort");
        const html = $(e).html();
//	console.log("sort", sort, html, sort_type);

        // activate this dropdown item
        $(e).parents(".dropdown-menu").find(".dropdown-item").removeClass("active");
        $(e).addClass("active");

        // set the selected sort type for this dropdown
        $(e).parents(".sort-dropdown").attr("data-sort", sort);

        // set the active label
        $(e).parents(".sort-dropdown").find ("label span").html(html);

        // make it as if radio was selected
        $("#sort-"+sort_type).trigger("click");

        // update preferred selection
        if (sort.startsWith("personalized"))
            localSet("sort-personalized", sort);
        else if (sort.startsWith("popular"))
            localSet("sort-popular", sort);

        const ready = getBranchAttr($(e), "data-ready") == "true";
        if (ready)
        {

//	    console.log("push sub", sort);
            applySort(sort);
        }
    }

    function activateSort(sort)
    {
//	console.log("activate", sort);
        // just try to click it
        $("#sort-"+sort).trigger("click");

        // select matching menu item and set it
        $(".dropdown-item[data-sort=\""+sort+"\"]").trigger("click");
    }


    function formatProfilePreview(pubkey, p, about) {
        let name = getProfileName(pubkey);
        let img = "";
        const thumb = formatThumbUrl(pubkey, "picture", false);
        try
        {
            name = getProfileName(pubkey, p);
            img = getProfilePicture(p);
        }
        catch (e) {};

        const psize = 20;
        let html = `
<img style='width: ${psize}px; height: ${psize}px' 
 data-src='${san(img)}' src='${thumb}' 
 class="profile ${img ? '' : 'd-none'}" onerror="javascript:replaceImgSrc(this)"> ${name}
`;
        if (about && p.about)
        {
            let a = p.about;
            if (a.length > 200)
                a = a.substring(0, 200) + "...";
            html += `<p class="card-text mt-1 mb-1">${san(a)}</p>`;
        }

        return html;
    }

    async function followUnfollowAll(unfollow) {
        if (!serp) return;

        if (!login_pubkey || !window.nostr) {
            $("#login-modal").modal("show");
            return;
        }

        // needed to know our relays, for any list
        await ensureContactList();

        // follows => the same list
        let list = latest_contact_list;
        if (!list) {
            toastError("Cannot find your current contact list");
            return;
        }

        let html = `
`;

        for (p of serp) {
            const profile = formatProfilePreview(p.pubkey, p, /* about */true);
            html += `
<div class="card" data-pubkey='${p.pubkey}'>
  <div class="card-body">
    ${profile}
    <button type="button" class="btn-close float-end" aria-label="Close"></button>
  </div>
</div>	
`;
        }

        const sel = "#list-update-modal";
        $(sel).find(".profiles").html(html);
        $(sel).find(".modal-title").html(unfollow ? "Remove from list" : "Add to list");
        $(sel).find("#confirm-list-update-button").html(unfollow ? "Remove" : "Add");
        $(sel).attr("data-unlist", unfollow ? "true" : "");

        $(sel).find(".modal-body .btn-close").on("click", (e) => {
            const card = $(e.target).parent().parent();
            card.addClass("d-none");
            card.attr("data-off", "true");
        });

        $(sel).attr("data-lists", false);
        $(sel).modal("show");
    }

    function getTag(e, tag) {
        for (const t of e?.tags)
        {
            if (t.length >= 2 && t[0] == tag)
                return t[1];
        }
        return "";
    }

    async function getLatestLabels (pubkey) {

        $("#search-spinner").removeClass("d-none");

        const sub = {
            kinds: [KIND_LABEL],
            authors: [pubkey],
            '#L': [LABEL_CATEGORY],
            limit: 200,
        };

        // FIXME get from all relays, then merge and choose the latest ones!
        const events = await getNostrEvents(sub, RELAY_ALL);

        $("#search-spinner").addClass("d-none");

        return events;
    }

    async function ensureLabelled(target, label, unlabel) {

        if (!login_pubkey || !window.nostr) {
            $("#login-modal").modal("show");
            return;
        }

        if (!relays)
        {
            toastError("No active relays found, sorry!");
            return;
        }

        // we need CL for write relays
        await ensureContactList();

        let event = null;
        if (unlabel) {

            const sub = {
                kinds: [KIND_LABEL],
                authors: [login_pubkey],
                '#e': [target],
                '#l': [label],
                '#L': [LABEL_CATEGORY],
                limit: 1,
            };

            const events = await getNostrEvents(sub, RELAY_ALL);
            if (events && events.length > 0)
            {
                event = {
                    kind: KIND_DELETE,
                    content: "",
                    tags: [
                        ["e", events[0].id],
                    ],
                };
            }
            else
            {
                toastError("Label not found on relays");
                return;
            }

        } else {

            event = {
                kind: KIND_LABEL,
                content: "",
                tags: [
                    ["l", label, LABEL_CATEGORY],
                    ["L", LABEL_CATEGORY],
                    ["e", target, "wss://relay.nostr.band"],
                ],
            };
        }

        const contact_relays = getContactRelays();

        const r = await sendNostrMessage(event, contact_relays);
        console.log("label result", r);

        if (r)
        {
            updateLabels(r);
        }
        else
        {
            toastError("Failed to send to Nostr network");
        }
    }

    async function addLabel(event_id) {
        $("#new-label-modal").attr("data-eid", event_id);
        $("#new-label-modal").modal ("show");
    }

    $("#confirm-new-label-button").on("click", async function (e) {
        if (!window.nostr || !login_pubkey)
        {
            toastError("Install nostr extension!");
            $("#new-label-modal").modal("hide");
            return;
        }

        const eid = $("#new-label-modal").attr("data-eid");
        const label = $("#new-label-modal input").val();
        if (!label) {
            toastError("Please enter the label");
            return;
        }
        console.log("eid", eid, "label", label);

        ensureLabelled(eid, label, false);

        $("#new-label-modal").modal("hide");
    });

    async function getLatestLists (pubkey) {

        $("#search-spinner").removeClass("d-none");

        const sub = {
            kinds: [KIND_PEOPLE_LIST],
            authors: [pubkey],
            limit: 100,
        };

        // FIXME get from all relays, then merge and choose the latest ones!
        const events = await getNostrEvents(sub, RELAY_ALL);
        $("#search-spinner").addClass("d-none");

        // reset
        let lists = [];
        for (const e of events)
        {
            let notif = false;
            let d = "";
            let name = "";
            let desc = "";
            let size = 0;
            for (const t of e?.tags)
            {
                if (t.length < 2)
                    continue;

                if (t[0] == "d")
                {
                    if (t[1].startsWith ("notifications/") || t[1].startsWith("chats/"))
                        notif = true;
                    else
                        d = t[1];
                }
                if (t.length > 1 && t[0] == "name")
                    name = t[1];
                if (t.length > 1 && t[0] == "description")
                    desc = t[1];
                if (t.length > 1 && t[0] == "p" && t[1].length == 64)
                    size++;
            }

            if (notif)
                continue;

            e.d = d;
            e.name = name || d;
            e.desc = desc;
            e.size = size;
            lists.push (e);
        }

        lists.sort (function (a, b) { if (a.name < b.name) return -1; if (a.name > b.name) return 1; return 0 });

        return lists;
    }

    async function listUnlistAll(unlist, new_list_pubkey) {

        if (!login_pubkey || !window.nostr) {
            $("#login-modal").modal("show");
            return;
        }

        if (!serp) return;

        // need CL to get the list of user's relays
        if (!latest_contact_list)
            latest_contact_list = await getLatestNostrEvent(KIND_CONTACT_LIST, login_pubkey);

        latest_lists = await getLatestLists(login_pubkey);
        if (unlist && !latest_lists)
        {
            toastError("You have no lists");
            return;
        }

        let html = `
<div class='mt-2 mb-1'><b>Select list:</b></div>
<select class="form-select" aria-label="Select list">
`;
        const last_list = localGet("last_list");
        for (const l of latest_lists)
        {
            html += `
  <option value="${l.id}" ${!new_list_pubkey && last_list == l.id ? "selected" : ""}>${l.name}</option>
`;
        }
        if (!unlist)
            html += `<option value='' ${new_list_pubkey ? "selected" : ""}>+ New List</option>`;
        html += `
</select>
<div class='list-name ${!new_list_pubkey && (unlist || latest_lists) ? "d-none" : ""}'>
<div class='mt-2 mb-1'><b>List name:</b></div>
<input type='text' class='form-control' placeholder='Enter list name'>
</div>
<div class='mt-2 mb-1'><b>Profiles:</b></div>
`;
        $("#list-update-modal .list-info").html (html);

        $("#list-update-modal .list-info select").on("change", function (e) {
            const list_id = $("#list-update-modal .list-info select").val();
            if (!list_id)
                $("#list-update-modal .list-info .list-name").removeClass("d-none");
            else
                $("#list-update-modal .list-info .list-name").addClass("d-none");
        });

        // reset
        html = `
`;
        for (p of serp) {
            if (new_list_pubkey && p.pubkey != new_list_pubkey)
                continue;

            const profile = formatProfilePreview(p.pubkey, p, /* about */true);
            html += `
<div class="card" data-pubkey='${p.pubkey}'>
  <div class="card-body">
    ${profile}
    <button type="button" class="btn-close float-end" aria-label="Close"></button>
  </div>
</div>	
`;
        }

        const sel = "#list-update-modal";
        $(sel).find(".profiles").html(html);
        $(sel).find(".modal-title").html(unlist ? "Remove from list" : "Add to list");
        $(sel).find("#confirm-list-update-button").html(unlist ? "Remove" : "Add");
        $(sel).attr("data-unlist", unlist ? "true" : "");

        $(sel).find(".modal-body .btn-close").on("click", (e) => {
            const card = $(e.target).parent().parent();
            card.addClass("d-none");
            card.attr("data-off", "true");
        });

        $(sel).attr("data-lists", true);
        $(sel).modal("show");

        if (new_list_pubkey)
            $(sel).find(".list-name input").focus();
    }

    $("#confirm-list-update-button").on("click", async function (e) {

        const adds = [];
        const dels = [];

        const lists = $("#list-update-modal").attr("data-lists") == "true";
        const unlist = $("#list-update-modal").attr("data-unlist") == "true";

        $("#list-update-modal .profiles .card").each((i, e) => {
            const pk = getBranchAttr($(e), 'data-pubkey');
            const off = getBranchAttr($(e), 'data-off');
            if (off != 'true')
                (unlist ? dels : adds).push(pk);
        });

        if (lists)
        {
            const list_id = $("#list-update-modal .list-info select").val();
            console.log("selected", list_id);

            let list = null;
            if (!list_id)
            {
                const list_name = $("#list-update-modal .list-info .list-name input").val();
                if (!list_name)
                {
                    toastError("Enter new list name");
                    return;
                }

                // create the list
                list = {
                    d: list_name,
                    name: list_name,
                    size: 1,
                    content: "",
                    pubkey: login_pubkey,
                    kind: 30000,
                    tags:[
                        ["d", list_name],
                        ["name", list_name],
                    ]
                };
            }
            else
            {
                // find the list
                for (const l of latest_lists)
                {
                    if (l.id == list_id)
                    {
                        list = l;
                        break;
                    }
                }
            }

            if (!list)
            {
                toastError("Failed to find the selected list");
            }
            else
            {
                // edit the list
                list = await editPubkeyList(list, adds, dels, /* nostr.band */"10000");

                if (list)
                {
                    // update the last
                    localSet("last_list", list.id);

                    updateLatestList(list);
                    updateLists();

                    toastOk("Great!", "List updated on relays");
                }
                else
                {
                    toastError("Failed to update the list");
                }
            }
        }
        else
        {
            // edit the list
            latest_contact_list = await editPubkeyList(latest_contact_list, adds, dels, /* nostr.band */"10000");

            if (latest_contact_list)
            {
                updateFollows();
                toastOk("Great!", "List updated on relays");
            }
            else
            {
                toastError("Failed to update the list");
            }
        }

        $("#list-update-modal").modal("hide");
    });

    async function followAll() {
        followUnfollowAll(false);
    }

    async function unfollowAll() {
        followUnfollowAll(true);
    }

    async function listAll() {
        listUnlistAll(false);
    }

    async function unlistAll() {
        listUnlistAll(true);
    }

    async function showUser() {

        const pubkey = login_pubkey;

        $("#search-spinner").removeClass("d-none");
        const meta = await getLatestNostrEvent(KIND_META, pubkey);
        $("#search-spinner").addClass("d-none");
        // console.log("meta", meta);

        let p = null;
        try
        {
            p = JSON.parse(meta.content);
        }
        catch (e) {};

        const html = formatProfilePreview(pubkey, p);
        $("#user .name").html(html);

        const npub = getNpub(pubkey);
        $("#user .profile").attr("href", "/" + npub);
        $("#user .profile").on("click", (e) => {
            e.preventDefault();
            gotoProfile(pubkey);
        });

        const posts_q = npub;
        $("#user .posts").attr("href", "/?type=posts&q=" + encodeURIComponent(posts_q));
        $("#user .posts").on("click", (e) => {
            e.preventDefault();
            startSearchScroll(posts_q, 0, 'posts', '');
        });

        const following_q = "following:" + npub;
        $("#user .following").attr("href", "/?type=profiles&q=" + encodeURIComponent(following_q));
        $("#user .following").on("click", (e) => {
            e.preventDefault();
            startSearchScroll(following_q, 0, 'profiles', '');
        });

        const feed_q = "following:" + npub;
        $("#user .feed").attr("href", "/?type=posts&q=" + encodeURIComponent(feed_q));
        $("#user .feed").on("click", (e) => {
            e.preventDefault();
            startSearchScroll(following_q, 0, 'posts', '');
        });

        $("#login").addClass("d-none");
        $("#about-menu").addClass("d-none");
        $("#user").removeClass("d-none");
    }

    function showAnon() {
        $("#about-menu").removeClass("d-none");
        $("#login").removeClass("d-none");
        $("#user").addClass("d-none");
    }

    async function initUser () {
        // render the user if they've been logged in && extension user hasn't changed
        if (login_pubkey && login_pubkey == (await window.nostr.getPublicKey()))
        {
            showUser();
        }
        else
        {
            showAnon();
        }
    };

    $("#sort-buttons .dropdown-item").on("click", (e) => {
        e.preventDefault();
        setSort(e.target);
    });

    setTimeout(() => {
        //	console.log("ready");
        $("#sort-buttons").attr("data-ready", "true");
    }, 0);

    const sort = localGet('sort');
    const sort_popular = localGet('sort-popular');
    const sort_personalized = localGet('sort-personalized');
    //    console.log(sort);
    if (sort_popular)
        $(".dropdown-item[data-sort=\""+sort_popular+"\"]").trigger("click");
    if (sort_personalized)
        $(".dropdown-item[data-sort=\""+sort_personalized+"\"]").trigger("click");
    activateSort(sort);

    function applyScope(scope) {
        localSet("scope", scope);
        setTimeout(function () {
            const q = $("#q").val().trim();
            if (!q)
                return;

            $("#search").trigger("submit");
        }, 0);
    }

    function activateScope(scope) {
        $("#scope-"+scope).trigger("click");
    }

    $("input[name=\"scope\"]").on("click", (e) => {
        const ready = getBranchAttr($(e.target), "data-ready") == "true";
        if (!ready)
            return;

        const scope = getBranchAttr($(e.target), "data-scope");
        if (scope == "personal" && !localGet("scope-pubkey"))
            $("#scope-modal").modal("show");
        else
            applyScope(scope);
    });

    $("#scope-personal-settings").on("click", () => {
        $("#scope-modal").modal("show");
    });

    $("#clear-pubkey-button").on("click", () => {
        $("#scope-pubkey").val("");
    });

    $("#accept-scope-button").on("click", () => {
        let pubkey = $("#scope-pubkey").val();
        if (pubkey)
        {
            if (pubkey.startsWith ("npub"))
            {
                let {type, data} = tools.nip19.decode(pubkey)
                if (type == "npub")
                    pubkey = data;
            }
            try
            {
                getNpub(pubkey);
            }
            catch (e)
            {
                toastError("Please type a valid pubkey");
                return;
            }
        }

        localSet("scope-pubkey", pubkey);
        $("#scope-modal").modal("hide");
    });

    $("#get-extension-pubkey-button").on("click", async () => {
        try
        {
            const pubkey = await window.nostr.getPublicKey();
            if (pubkey)
                $("#scope-pubkey").val(pubkey);
            else
                throw "Empty pubkey";
        }
        catch (e)
        {
            toastError("Failed to get pubkey");
        }
    });

    $("#embed-copy").on("click", async (e) => {
        const data = $("#embed-code").val();
        copyToClip(data);
    });

    $("#embed-url-copy").on("click", async (e) => {
        const data = $("#embed-url").val();
        copyToClip(data);
    });

    const client = localGet("chosen-client");
    if (client)
    {
        selectClient(client, true);
        $("#client-open").attr("disabled", false);
    }

    function setDarkMode(dark) {
        const theme = dark ? "dark" : "light";
        $("html").attr("data-bs-theme", theme);
        localSet("theme", theme);
    }

    $("#dark-mode, #dark-mode-profile").on("click", (e) => {
        setDarkMode($(e.target).is(":checked"));
    });

    $("#scope-modal").on('show.bs.modal', e => {
        const pubkey = localGet("scope-pubkey");
        $("#scope-pubkey").val(pubkey);
    });

    $("#scope-modal").on('hidden.bs.modal', e => {
        if (localGet("scope-pubkey"))
            $("#scope-personal").trigger("click");
        else
            $("#scope-global").trigger("click");
    });

    const scope = localGet("scope");
    $("#scope-"+scope).trigger("click");

    $("#object-types a").on("click", function (e) {
        e.preventDefault();
        const type = $(e.target).attr("data-type");
        setType(type);
    });

    $("#login a").on("click", async function (e) {
        e.preventDefault();
        $("#login-modal").modal("show");
    });

    $("#login-ext").on("click", async function (e) {
        e.preventDefault();
        $("#login-modal").modal("hide");

        if (!window.nostr)
        {
            toastError("No browser extension found!");
            return;
        }

        try
        {
            await enableNostr();
            login_pubkey = await window.nostr.getPublicKey();
            localSet("login", login_pubkey);

            showUser();

            updateNostrContactList();
            updateNostrLists();
            updateNostrLabels();
//      latest_contact_list = await getLatestNostrEvent(KIND_CONTACT_LIST, login_pubkey);
//      updateFollows();
        }
        catch (e)
        {
            console.log("failed to login", e);
            if (window.nostr)
                toastError("Failed to login with browser extension");
            else
                $("#login-modal").modal("show");
        }
    });

    $("#user .logout").on("click", (e) => {
        e.preventDefault();
        localSet("login", "");
        login_pubkey = "";
        latest_contact_list = null;
        showAnon();
        updateFollows();
    });

    // need to init relay list first
    setRelays([]);

    setTimeout(() => {
        $("#scope-buttons").attr("data-ready", "true");
    }, 0);

    // activate the tabs, as per bootstrap docs
    {
        const triggerTabList = document.querySelectorAll('#trending a.nav-link')
        triggerTabList.forEach(triggerEl => {
            const tabTrigger = new bootstrap.Tab(triggerEl)

            triggerEl.addEventListener('click', event => {
                event.preventDefault()
                tabTrigger.show()
            })
        })
    }

    $("#q").focus ();

    // schedule initUser after nostr extension is ready
    addOnNostr(initUser);
    initUser();

    // init the nostr extension
    enableNostr();

    // process the query-string params
    updateParamsState();

});

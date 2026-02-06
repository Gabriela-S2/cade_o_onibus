// 1. INICIALIZAÇÃO DO MAPA
var map = L.map('map').setView([-16.0300, -47.9400], 11);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(map);

var markersOnibus = {}; 
var vendoRota = false; 
var busSelecionado = false; 
var rotaLayerGroup = L.layerGroup().addTo(map);

var coordsOrigemCache = null;
var coordsDestinoCache = null;
var paradasLocais = [];

// 2. CARREGAMENTO
fetch('/api/paradas').then(res => res.json()).then(paradas => {
    paradasLocais = paradas;
});

// 3. INTERAÇÃO (CLIQUE NO ÔNIBUS)
function focarNoOnibus(bus) {
    map.flyTo([bus.lat, bus.lng], 16, { duration: 1.5 });
    busSelecionado = true; 

    var tempoTexto = bus.status;
    if (bus.status && bus.status.includes('às')) {
        try {
            var horaString = bus.status.split('às')[1].trim();
            var partes = horaString.split(':');
            var agora = new Date();
            var chegada = new Date();
            chegada.setHours(parseInt(partes[0]), parseInt(partes[1]), 0);
            if (chegada < agora && (agora.getHours() - chegada.getHours()) > 12) chegada.setDate(chegada.getDate() + 1);
            var diff = Math.ceil((chegada - agora) / 60000);
            tempoTexto = diff <= 0 ? "Chegando agora" : `${diff} min <span style='font-size:12px;opacity:0.8'>(${horaString})</span>`;
        } catch(e) {}
    }

    if (!vendoRota) {
        var container = document.getElementById('lista-onibus');
        container.innerHTML = `
            <div class="detail-card">
                <div class="detail-color-strip" style="background-color: ${bus.cor};"></div>
                <div class="detail-header">
                    <div style="flex:1;">
                        <h2 class="detail-route-name">${bus.linha}</h2>
                        <div class="detail-company">${bus.empresa}</div>
                    </div>
                    <div style="display:flex; gap:10px;">
                        <i class="fas fa-bus" style="color:${bus.cor}; font-size:24px;"></i>
                        <button onclick="voltarParaLista()" class="btn-close-top">&times;</button>
                    </div>
                </div>
                <div class="detail-dest-box"><span class="detail-label">DESTINO</span><span class="detail-value">${bus.destino}</span></div>
                <div class="detail-time-badge"><i class="far fa-clock"></i> <span>${tempoTexto}</span></div>
                <div class="detail-next-stop"><i class="fas fa-map-marker-alt" style="color:#e74c3c;"></i><span>Próxima: <strong>${bus.proxima_parada}</strong></span></div>
                <button onclick="voltarParaLista()" class="btn-back-list"><i class="fas fa-arrow-left"></i> Voltar para lista</button>
            </div>
        `;
    }
}

function voltarParaLista() {
    busSelecionado = false; 
    map.setView([-16.0300, -47.9400], 11);
    document.getElementById('lista-onibus').innerHTML = '<div style="text-align:center; padding:20px; color:#999;">Atualizando frota...</div>';
}

function atualizarInterface(buses) {
    if (vendoRota || busSelecionado) return; 
    var container = document.getElementById('lista-onibus');
    container.innerHTML = "";
    if (buses.length === 0) { container.innerHTML = "<p style='text-align:center; color:#999; margin-top:15px;'>Nenhum ônibus circulando agora.</p>"; return; }
    buses.forEach(bus => {
        var card = document.createElement('div');
        card.className = 'bus-card';
        card.onclick = function() { focarNoOnibus(bus); };
        card.innerHTML = `<div class="bus-dot" style="background-color: ${bus.cor};"></div><div class="bus-info"><h4>${bus.linha}</h4><p style="font-size:12px; color:#666">${bus.destino}</p></div><div class="bus-time"><i class="fas fa-chevron-right"></i></div>`;
        container.appendChild(card);
    });
}

function atualizarFrota() {
    fetch('/api/frota_tempo_real').then(res => res.json()).then(data => {
        var ativosIds = [];
        data.buses.forEach(bus => {
            ativosIds.push(bus.id);
            var busIcon = L.divIcon({className: 'custom-bus-icon', html: `<i class="fas fa-bus"></i>`, iconSize:[36,36], popupAnchor:[0,-30]});
            if (markersOnibus[bus.id]) {
                var m = markersOnibus[bus.id];
                m.setLatLng([bus.lat, bus.lng]);
                m.busData = bus; 
                if(m.getElement()) m.getElement().style.borderColor = bus.cor;
            } else {
                var m = L.marker([bus.lat, bus.lng], {icon: busIcon}).addTo(map);
                m.busData = bus;
                m.on('click', function() { focarNoOnibus(this.busData); });
                setTimeout(() => { if(m.getElement()) m.getElement().style.borderColor = bus.cor; }, 100);
                markersOnibus[bus.id] = m;
            }
        });
        for (var id in markersOnibus) { if (!ativosIds.includes(id)) { map.removeLayer(markersOnibus[id]); delete markersOnibus[id]; }}
        atualizarInterface(data.buses);
    });
}

// 4. BUSCA E AUTOCOMPLETE
function configurarAutocomplete(inputId, suggestionsId, tipo) {
    var input = document.getElementById(inputId);
    var box = document.getElementById(suggestionsId);
    var timeout = null;
    input.addEventListener('input', function() {
        var query = this.value.toLowerCase();
        clearTimeout(timeout);
        if(query.length < 2) { box.style.display = 'none'; return; }
        timeout = setTimeout(() => { buscarSugestoesHibridas(query, box, input, tipo); }, 150);
    });
    input.addEventListener('focus', function() { if(this.value === "") { box.innerHTML = ""; adicionarOpcaoGPS(box, input, tipo); box.style.display = 'block'; } });
    document.addEventListener('click', function(e) { if (e.target !== input && e.target !== box) { box.style.display = 'none'; } });
}

function adicionarOpcaoGPS(box, input, tipo) {
    var div = document.createElement('div');
    div.className = 'suggestion-item sugg-gps';
    div.innerHTML = '<i class="fas fa-crosshairs"></i> Usar minha localização atual';
    div.onclick = function() { usarMinhaLocalizacao(tipo); box.style.display = 'none'; };
    box.appendChild(div);
}

async function buscarSugestoesHibridas(query, box, input, tipo) {
    box.innerHTML = "";
    adicionarOpcaoGPS(box, input, tipo);
    var encontrou = false;
    var locais = paradasLocais.filter(p => p.stop_name.toLowerCase().includes(query)).slice(0, 5);
    if (locais.length > 0) {
        box.insertAdjacentHTML('beforeend', "<div style='padding:5px 10px; color:#007bff; font-size:11px; font-weight:bold;'>PARADAS</div>");
        locais.forEach(p => {
            encontrou = true;
            var div = document.createElement('div');
            div.className = 'suggestion-item';
            div.innerHTML = `<span class="sugg-title">🚏 ${p.stop_name}</span>`;
            div.onclick = function() {
                input.value = p.stop_name;
                var coords = { lat: p.stop_lat, lon: p.stop_lon };
                if(tipo === 'origem') coordsOrigemCache = coords; else coordsDestinoCache = coords;
                box.style.display = 'none';
                map.setView([coords.lat, coords.lon], 15);
                L.marker(coords).addTo(map).bindPopup(p.stop_name).openPopup();
            };
            box.appendChild(div);
        });
    }
    try {
        var res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query + ", Luziânia Goiás")}&limit=3&countrycodes=br`);
        var data = await res.json();
        if (data.length > 0) {
            box.insertAdjacentHTML('beforeend', "<div style='padding:5px 10px; color:#666; font-size:11px; font-weight:bold; border-top:1px solid #eee;'>ENDEREÇOS</div>");
            data.forEach(l => {
                encontrou = true;
                var div = document.createElement('div');
                div.className = 'suggestion-item';
                div.innerHTML = `<span class="sugg-title">📍 ${l.display_name.split(',')[0]}</span><span class="sugg-desc">${l.display_name}</span>`;
                div.onclick = function() {
                    input.value = l.display_name.split(',')[0]; 
                    var coords = { lat: parseFloat(l.lat), lon: parseFloat(l.lon) };
                    if(tipo === 'origem') coordsOrigemCache = coords; else coordsDestinoCache = coords;
                    box.style.display = 'none';
                };
                box.appendChild(div);
            });
        }
    } catch(e) {}
    if (!encontrou) box.insertAdjacentHTML('beforeend', "<div class='suggestion-item' style='color:#999'>Nenhum local encontrado.</div>");
    box.style.display = 'block';
}

configurarAutocomplete('input-origem', 'sugestoes-origem', 'origem');
configurarAutocomplete('input-destino', 'sugestoes-destino', 'destino');

// 5. BUSCA ROTA INTELIGENTE
async function buscarRotaInteligente() {
    var o = document.getElementById('input-origem').value;
    var d = document.getElementById('input-destino').value;
    var selH = document.getElementById('select-horario').value;
    var dataIso = new Date().toISOString();
    
    if (selH === 'custom') dataIso = new Date(document.getElementById('input-data-custom').value).toISOString();
    else if (selH !== 'agora') { var t = new Date(); t.setMinutes(t.getMinutes() + parseInt(selH)); dataIso = new Date(t.getTime() - (t.getTimezoneOffset()*60000)).toISOString().slice(0,19); }
    else { var t = new Date(); dataIso = new Date(t.getTime() - (t.getTimezoneOffset()*60000)).toISOString().slice(0,19); }

    if(!o || !d) { alert("Preencha origem e destino!"); return; }

    vendoRota = true; 
    document.getElementById('lista-onibus').innerHTML = '<div style="text-align:center; padding:20px;"><i class="fas fa-spinner fa-spin"></i> Calculando...</div>';
    rotaLayerGroup.clearLayers(); 

    try {
        if (!coordsOrigemCache) coordsOrigemCache = await geocodar(o + ", Luziânia Goiás");
        if (!coordsDestinoCache) coordsDestinoCache = await geocodar(d + ", Luziânia Goiás");

        if(!coordsOrigemCache || !coordsDestinoCache) {
            alert("Local não encontrado."); vendoRota = false; return;
        }

        L.marker(coordsOrigemCache).addTo(rotaLayerGroup).bindPopup("Origem").openPopup();
        L.marker(coordsDestinoCache, {icon: iconeDestino()}).addTo(rotaLayerGroup).bindPopup("Destino");

        var url = `/api/planejar_viagem?lat_origem=${coordsOrigemCache.lat}&lon_origem=${coordsOrigemCache.lon}&lat_destino=${coordsDestinoCache.lat}&lon_destino=${coordsDestinoCache.lon}&data_inicio=${dataIso}`;
        
        // --- CORREÇÃO IMPORTANTE AQUI ---
        var res = await fetch(url);
        var dados = await res.json(); // Antes estava response.json(), agora está res.json()
        // --------------------------------

        if(dados.erro) {
            document.getElementById('lista-onibus').innerHTML = `
                <div style="padding:20px; text-align:center; color:#dc3545;">
                    <i class="fas fa-exclamation-circle" style="font-size:30px; margin-bottom:10px;"></i><br>
                    <strong>${dados.erro}</strong><br><br>
                    <button onclick="resetBusca()" style="padding:8px 15px; border:1px solid #ccc; background:#fff; cursor:pointer; border-radius:5px;">Tentar Novamente</button>
                </div>`;
            return;
        }

        await desenharCaminho(coordsOrigemCache, dados, coordsDestinoCache);
        exibirInstrucoes(dados);

    } catch (e) { 
        console.error(e); 
        document.getElementById('lista-onibus').innerHTML = `<div style="text-align:center; padding:20px; color:red;">Erro de conexão. Tente novamente.</div>`;
    }
}

function resetBusca() {
    vendoRota = false;
    busSelecionado = false;
    rotaLayerGroup.clearLayers();
    document.getElementById('lista-onibus').innerHTML = '<p style="text-align:center; color:#999; margin-top:15px;">Carregando frota...</p>';
    document.getElementById('input-origem').value = "";
    document.getElementById('input-destino').value = "";
    coordsOrigemCache = null;
    coordsDestinoCache = null;
}

// 6. DESENHO E EXIBIÇÃO
async function desenharCaminho(origem, rota, destino) {
    var coordsEmb = rota.onibus.coords_embarque;
    var coordsDes = rota.onibus.coords_desembarque;
    var objEmb = {lat: coordsEmb[0], lon: coordsEmb[1]};
    var objDes = {lat: coordsDes[0], lon: coordsDes[1]};

    await tracarCaminhada(origem, objEmb);
    var pathBus = rota.onibus.caminho_completo || [coordsEmb, coordsDes];
    L.polyline(pathBus, { color: '#0056b3', weight: 6, opacity: 0.8 }).addTo(rotaLayerGroup);
    await tracarCaminhada(objDes, destino);

    L.circleMarker(coordsEmb, {radius:6, color:'black', fillColor:'white', fillOpacity:1}).addTo(rotaLayerGroup);
    L.circleMarker(coordsDes, {radius:6, color:'black', fillColor:'white', fillOpacity:1}).addTo(rotaLayerGroup);
    map.fitBounds(L.latLngBounds([origem, coordsEmb, coordsDes, destino]), {padding:[50,50]});
}

async function tracarCaminhada(pontoA, pontoB) {
    try {
        var res = await fetch(`https://router.project-osrm.org/route/v1/foot/${pontoA.lon},${pontoA.lat};${pontoB.lon},${pontoB.lat}?overview=full&geometries=geojson`);
        var data = await res.json();
        if(data.routes && data.routes.length > 0) {
            var latLngs = data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
            L.polyline(latLngs, {color: '#666', dashArray: '5, 10', weight: 4, opacity: 0.8}).addTo(rotaLayerGroup);
        } else { L.polyline([pontoA, pontoB], {color: '#666', dashArray: '5, 10', weight: 4}).addTo(rotaLayerGroup); }
    } catch(e) { L.polyline([pontoA, pontoB], {color: '#666', dashArray: '5, 10', weight: 4}).addTo(rotaLayerGroup); }
}

function exibirInstrucoes(rota) {
    vendoRota = true; 
    var html = `
        <div class="bus-card" style="border-left: 5px solid #0056b3; display:block; cursor:default;">
            <div style="display:flex; justify-content:space-between; margin-bottom:10px;">
                <span style="font-weight:bold; color:#0056b3; font-size:16px;">🚌 ${rota.onibus.linha}</span>
                <span style="background:#e7f1ff; color:#0056b3; padding:2px 8px; border-radius:10px; font-size:12px; font-weight:bold;">Chegada: ${rota.caminhada_destino.hora_final_estimada}</span>
            </div>
            <div style="font-size:13px; margin-bottom:10px;"><i class="fas fa-walking"></i> Caminhe <b>${rota.caminhada_origem.tempo_min} min</b> até o ponto.</div>
            <div style="font-size:13px; font-weight:bold; color:#0056b3;">Embarque: ${rota.onibus.horario_embarque}</div>
            <div style="font-size:13px;">Desembarque: ${rota.onibus.horario_desembarque}</div>
        </div>
        <button onclick="resetBusca()" style="width:100%; padding:10px; background:#f8f9fa; border:1px solid #ddd; cursor:pointer; margin-top:10px;">🔄 Nova Busca</button>
    `;
    document.getElementById('lista-onibus').innerHTML = html;
}

// Utils
async function geocodar(end) {
    var res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(end)}&limit=1`);
    var json = await res.json();
    if(json.length > 0) return { lat: parseFloat(json[0].lat), lon: parseFloat(json[0].lon) };
    return null;
}
function usarMinhaLocalizacao(t) {
    if(!navigator.geolocation) return alert("GPS não suportado.");
    navigator.geolocation.getCurrentPosition(p => {
        var c = {lat:p.coords.latitude, lon:p.coords.longitude};
        if(t==='origem') coordsOrigemCache=c; else coordsDestinoCache=c;
        document.getElementById('input-'+t).value = "Minha Localização Atual";
    });
}
function inverterRota() {
    var o = document.getElementById('input-origem');
    var d = document.getElementById('input-destino');
    var temp = o.value; o.value = d.value; d.value = temp;
    var tempC = coordsOrigemCache; coordsOrigemCache = coordsDestinoCache; coordsDestinoCache = tempC;
}
function iconeDestino() { return L.icon({ iconUrl: 'https://cdn-icons-png.flaticon.com/512/684/684908.png', iconSize: [30, 30], iconAnchor: [15, 30] }); }
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
function verificarHorarioPersonalizado() {
    var sel = document.getElementById('select-horario');
    var inp = document.getElementById('input-data-custom');
    if(sel.value === 'custom') { inp.style.display='block'; sel.style.display='none'; inp.focus(); }
}

setInterval(atualizarFrota, 1000);
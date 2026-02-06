from flask import Flask, render_template, jsonify, request, session, redirect, url_for, send_from_directory
from datetime import datetime, timedelta
from werkzeug.security import generate_password_hash, check_password_hash
import pandas as pd
import math
import csv
import os
import requests 
import sqlite3

# CONFIGURAÇÃO DO APP
app = Flask(__name__, template_folder='templates')
app.secret_key = 'sua_chave_secreta_aqui'

# --- BANCO DE DADOS (USUÁRIOS) ---
def init_db():
    """Cria a tabela de usuários se não existir"""
    with sqlite3.connect('users.db') as conn:
        c = conn.cursor()
        c.execute('''CREATE TABLE IF NOT EXISTS users 
                     (username TEXT PRIMARY KEY, password TEXT)''')
        # Cria admin padrão se não existir
        try:
            # Senha padrão: 1234
            c.execute("INSERT INTO users VALUES (?, ?)", ('admin', generate_password_hash('1234')))
            conn.commit()
        except sqlite3.IntegrityError:
            pass

init_db() # Executa ao iniciar

# --- CONFIGURAÇÃO DE CAMINHOS ---
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
GTFS_DIR = os.path.join(BASE_DIR, 'gtfs')
if not os.path.exists(GTFS_DIR): os.makedirs(GTFS_DIR)

# --- DADOS GLOBAIS ---
PARADAS, ROTAS, AGENCIAS = [], [], []
STOP_TIMES, DICT_PARADAS = {}, {}
ESCALA_DIARIA = []
CACHE_SHAPES = {} 

def carregar_dados():
    global PARADAS, DICT_PARADAS, ROTAS, AGENCIAS, STOP_TIMES
    try:
        # Carrega Paradas
        p_stops = os.path.join(GTFS_DIR, 'stops.txt')
        if os.path.exists(p_stops):
            df = pd.read_csv(p_stops).sort_values(by='stop_id')
            PARADAS = df.to_dict(orient='records')
            DICT_PARADAS = {p['stop_id']: p for p in PARADAS}
        
        # Carrega Rotas
        p_routes = os.path.join(GTFS_DIR, 'routes.txt')
        if os.path.exists(p_routes):
            df = pd.read_csv(p_routes)
            df.columns = [c.strip() for c in df.columns]
            df['route_id'] = df['route_id'].astype(str)
            ROTAS = df.to_dict(orient='records')

        # Carrega Agências
        p_agency = os.path.join(GTFS_DIR, 'agency.txt')
        if os.path.exists(p_agency):
            df = pd.read_csv(p_agency)
            df.columns = [c.strip() for c in df.columns]
            AGENCIAS = df.to_dict(orient='records')

        # Carrega Horários
        p_st = os.path.join(GTFS_DIR, 'stop_times.txt')
        if os.path.exists(p_st):
            df = pd.read_csv(p_st)
            df['stop_sequence'] = pd.to_numeric(df['stop_sequence'])
            df = df.sort_values(by=['trip_id', 'stop_sequence'])
            for trip_id, grupo in df.groupby('trip_id'):
                STOP_TIMES[str(trip_id)] = grupo['stop_id'].tolist()
        
        print(f"Dados carregados: {len(PARADAS)} paradas, {len(ROTAS)} rotas.")
    except Exception as e: print(f"Erro ao carregar dados: {e}")

# --- DESENHO DA RUA ---
def obter_caminho_real(p_origem, p_destino):
    chave = f"{p_origem['stop_id']}-{p_destino['stop_id']}"
    if chave in CACHE_SHAPES: return CACHE_SHAPES[chave]
    fallback = [[p_origem['stop_lat'], p_origem['stop_lon']], [p_destino['stop_lat'], p_destino['stop_lon']]]
    try:
        url = f"http://router.project-osrm.org/route/v1/driving/{p_origem['stop_lon']},{p_origem['stop_lat']};{p_destino['stop_lon']},{p_destino['stop_lat']}?overview=full&geometries=geojson"
        resp = requests.get(url, timeout=3, headers={'User-Agent': 'AppOnibus/1.0'}) 
        if resp.status_code == 200:
            data = resp.json()
            if data['routes']:
                coords = data['routes'][0]['geometry']['coordinates']
                path = [[c[1], c[0]] for c in coords]
                CACHE_SHAPES[chave] = path
                return path
    except: pass
    return fallback

# --- SIMULAÇÃO ---
TEMPO_MEDIO_PARADA_MIN = 3 
def gerar_escala_do_dia():
    escala = []
    hora_inicio = datetime.now().replace(hour=4, minute=0, second=0, microsecond=0)
    fim_dia = hora_inicio.replace(hour=23, minute=59)
    dict_agency = {str(a['agency_id']): a['agency_name'] for a in AGENCIAS}
    rotas_map = {str(r['route_id']): r for r in ROTAS}

    for trip_id, stops in STOP_TIMES.items():
        rota = rotas_map.get(trip_id)
        if not rota:
            for r_id, r_obj in rotas_map.items():
                if trip_id in r_id or r_id in trip_id: rota = r_obj; break
        if not rota: rota = {'route_short_name': trip_id, 'route_long_name': 'Rota '+trip_id, 'route_color': '000000', 'agency_id': '1'}

        r_nome = rota['route_short_name']
        r_emp = dict_agency.get(str(rota.get('agency_id', '1')), "Viação")
        r_cor = "#" + str(rota['route_color']).replace('#', '')
        dest = rota['route_long_name'].split(' x ')[-1] if ' x ' in rota['route_long_name'] else rota['route_long_name']
        freq = max(10, int((len(stops) * TEMPO_MEDIO_PARADA_MIN) / 2.5))
        hora = hora_inicio
        c = 1
        while hora < fim_dia:
            escala.append({"id": f"{r_nome}-{c:02d}", "linha": r_nome, "route_id": trip_id, "empresa": r_emp, "cor": r_cor, "destino": dest, "saida": hora})
            hora += timedelta(minutes=freq)
            c += 1
    return escala

carregar_dados()
ESCALA_DIARIA = gerar_escala_do_dia()

# --- FUNÇÕES GEOMÉTRICAS ---
def calcular_distancia(lat1, lon1, lat2, lon2):
    try:
        R = 6371 
        dlat = math.radians(lat2 - lat1); dlon = math.radians(lon2 - lon1)
        a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon/2)**2
        c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
        return R * c
    except: return 9999

def encontrar_paradas_proximas(lat, lon, raio_km=2.0):
    candidatas = []
    for p in PARADAS:
        d = calcular_distancia(lat, lon, p['stop_lat'], p['stop_lon'])
        if d <= raio_km: candidatas.append({'parada': p, 'distancia': d})
    candidatas.sort(key=lambda x: x['distancia'])
    return candidatas

# --- ROTAS DE LOGIN E REGISTRO ---

@app.route('/login', methods=['GET', 'POST'])
def login():
    erro = None
    if request.method == 'POST':
        usuario = request.form.get('usuario')
        senha = request.form.get('senha')
        
        with sqlite3.connect('users.db') as conn:
            c = conn.cursor()
            c.execute("SELECT password FROM users WHERE username = ?", (usuario,))
            user_data = c.fetchone()
            
            if user_data and check_password_hash(user_data[0], senha):
                session['logado'] = True
                return redirect(url_for('index'))
            else:
                erro = "Usuário ou senha incorretos."
    return render_template('login.html', erro=erro)

@app.route('/register', methods=['GET', 'POST'])
def register():
    erro = None
    sucesso = None
    if request.method == 'POST':
        usuario = request.form.get('usuario')
        senha = request.form.get('senha')
        
        if not usuario or not senha:
            erro = "Preencha todos os campos."
        else:
            with sqlite3.connect('users.db') as conn:
                c = conn.cursor()
                try:
                    hashed_pw = generate_password_hash(senha)
                    c.execute("INSERT INTO users VALUES (?, ?)", (usuario, hashed_pw))
                    conn.commit()
                    sucesso = "Conta criada! Faça login."
                    return redirect(url_for('login'))
                except sqlite3.IntegrityError:
                    erro = "Nome de usuário já existe."

    return render_template('register.html', erro=erro)

@app.route('/logout')
def logout():
    session.pop('logado', None)
    return redirect(url_for('login'))

@app.route('/')
def index():
    if not session.get('logado'):
        return redirect(url_for('login'))
    return render_template('index.html')

@app.route('/favicon.ico')
def favicon():
    return send_from_directory(os.path.join(app.root_path, 'static'),
                               'favicon.ico', mimetype='image/vnd.microsoft.icon')

# --- API ---
@app.route('/api/paradas')
def get_paradas(): return jsonify(PARADAS)
@app.route('/api/rotas')
def get_rotas(): return jsonify(ROTAS)
@app.route('/api/agencias')
def get_agencias(): return jsonify(AGENCIAS)

@app.route('/api/frota_tempo_real')
def get_frota_tempo_real():
    agora = datetime.now()
    buses = []
    for bus in ESCALA_DIARIA:
        route_id = bus['route_id']
        path = STOP_TIMES.get(route_id)
        if not path or len(path)<2: continue
        
        duracao = len(path) * TEMPO_MEDIO_PARADA_MIN
        delta = agora - bus['saida']
        min_corridos = delta.total_seconds() / 60
        
        if 0 <= min_corridos < duracao:
            idx_v = min_corridos / TEMPO_MEDIO_PARADA_MIN
            idx_ant = int(idx_v)
            idx_prox = min(idx_ant + 1, len(path) - 1)
            p_ant = DICT_PARADAS.get(path[idx_ant])
            p_prox = DICT_PARADAS.get(path[idx_prox])
            
            if p_ant and p_prox:
                shape = obter_caminho_real(p_ant, p_prox)
                prog = idx_v - idx_ant
                if len(shape) > 1:
                    idx_s = int(len(shape) * prog)
                    idx_s = min(idx_s, len(shape)-1)
                    lat, lng = shape[idx_s]
                else: lat, lng = shape[0]
                
                chegada = agora + timedelta(minutes=(duracao - min_corridos))
                buses.append({
                    "id": bus['id'], "linha": bus['linha'], "empresa": bus['empresa'],
                    "cor": bus['cor'], "destino": bus['destino'], "lat": lat, "lng": lng,
                    "status": f"Chega às {chegada.strftime('%H:%M')}", "proxima_parada": p_prox['stop_name']
                })
    return jsonify({"buses": buses})

@app.route('/api/planejar_viagem')
def planejar_viagem():
    try:
        lat_o = float(request.args.get('lat_origem'))
        lon_o = float(request.args.get('lon_origem'))
        lat_d = float(request.args.get('lat_destino'))
        lon_d = float(request.args.get('lon_destino'))
        data_str = request.args.get('data_inicio')
        agora = datetime.fromisoformat(data_str.replace('Z', '+00:00')).replace(tzinfo=None) if data_str else datetime.now()

        stops_origem = encontrar_paradas_proximas(lat_o, lon_o)
        stops_destino = encontrar_paradas_proximas(lat_d, lon_d)
        
        if not stops_origem or not stops_destino: return jsonify({"erro": "Nenhuma parada próxima encontrada."})

        melhor_rota = None
        for cand_o in stops_origem:
            p_e = cand_o['parada']
            for cand_d in stops_destino:
                p_d = cand_d['parada']
                if p_e['stop_id'] == p_d['stop_id']: continue
                for r_id, stops in STOP_TIMES.items():
                    if p_e['stop_id'] in stops and p_d['stop_id'] in stops:
                        if stops.index(p_e['stop_id']) < stops.index(p_d['stop_id']):
                            melhor_rota = {'r_id': r_id, 'p_e': p_e, 'p_d': p_d, 'idx_e': stops.index(p_e['stop_id']), 'idx_d': stops.index(p_d['stop_id']), 'dist_o': cand_o['distancia'], 'dist_d': cand_d['distancia']}
                            break
                if melhor_rota: break
            if melhor_rota: break
            
        if not melhor_rota: return jsonify({"erro": "Sem rota direta."})
        
        r_id_busca = str(melhor_rota['r_id'])
        r_info = next((r for r in ROTAS if str(r['route_id']) == r_id_busca), None)
        if not r_info: r_info = next((r for r in ROTAS if r_id_busca in str(r['route_id']) or str(r['route_id']) in r_id_busca), None)

        if r_info:
            nome = r_info['route_short_name']
            empresa = next((a['agency_name'] for a in AGENCIAS if str(a['agency_id']) == str(r_info.get('agency_id','1'))), "Viação")
        else: nome = "Linha " + r_id_busca; empresa = "Viação Local"
        
        caminho_onibus = obter_caminho_real(melhor_rota['p_e'], melhor_rota['p_d'])
        t_ape = math.ceil(melhor_rota['dist_o']*15)
        h_pt = agora + timedelta(minutes=t_ape)
        
        prox = None
        for b in ESCALA_DIARIA:
            if str(b['route_id']) == str(melhor_rota['r_id']):
                h_pass = b['saida'] + timedelta(minutes=(melhor_rota['idx_e']*TEMPO_MEDIO_PARADA_MIN))
                h_pass = h_pass.replace(year=h_pt.year, month=h_pt.month, day=h_pt.day)
                if h_pass > h_pt:
                    prox = b; h_emb = h_pass; 
                    h_des = h_emb + timedelta(minutes=(melhor_rota['idx_d']-melhor_rota['idx_e'])*TEMPO_MEDIO_PARADA_MIN)
                    break
        
        if not prox: return jsonify({"erro": "Sem horários futuros hoje."})
        
        return jsonify({
            "caminhada_origem": {"tempo_min": t_ape, "para_parada": melhor_rota['p_e']['stop_name'], "chegada_usuario_ponto": h_pt.strftime("%H:%M")},
            "onibus": {
                "linha": f"{nome} - {empresa}", "horario_embarque": h_emb.strftime("%H:%M"), "horario_desembarque": h_des.strftime("%H:%M"),
                "coords_embarque": [melhor_rota['p_e']['stop_lat'], melhor_rota['p_e']['stop_lon']],
                "coords_desembarque": [melhor_rota['p_d']['stop_lat'], melhor_rota['p_d']['stop_lon']],
                "desembarque_nome": melhor_rota['p_d']['stop_name'],
                "caminho_completo": caminho_onibus
            },
            "caminhada_destino": {"tempo_min": math.ceil(melhor_rota['dist_d']*15), "hora_final_estimada": (h_des + timedelta(minutes=math.ceil(melhor_rota['dist_d']*15))).strftime("%H:%M")}
        })
    except Exception as e: return jsonify({"erro": f"Erro interno: {str(e)}"})

# ROTAS ADMIN
@app.route('/admin')
def admin_panel(): return render_template('admin.html')
@app.route('/api/admin/add_stop', methods=['POST'])
def add_stop(): return jsonify({"success": True}) 
@app.route('/api/admin/add_route', methods=['POST'])
def add_route(): return jsonify({"success": True}) 
@app.route('/api/admin/save_path', methods=['POST'])
def save_path(): return jsonify({"success": True})

if __name__ == '__main__':
    app.run(debug=True, port=5000)
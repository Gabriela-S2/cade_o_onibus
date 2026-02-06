🚌 Cadê o Ônibus? — Sistema de Monitoramento e Rota (GTFS)
O Cadê o Ônibus? é uma aplicação web desenvolvida para facilitar o planejamento de viagens e o monitoramento de frotas de ônibus na região de Luziânia (GO) e Distrito Federal. O projeto utiliza dados padronizados no formato GTFS (General Transit Feed Specification) para simular o movimento dos veículos e calcular as melhores rotas para os usuários.

🚀 Funcionalidades
Monitoramento em Tempo Real (Simulado): Visualização dinâmica da posição dos ônibus no mapa com base nos horários estáticos do GTFS.

Planejador de Viagens Inteligente: Cálculo de rotas considerando o tempo de caminhada do usuário até a parada mais próxima e o horário de passagem do ônibus.

Autocomplete Híbrido: Busca de endereços e paradas integrando dados locais (GTFS) e globais (OpenStreetMap/Nominatim).

Interface Responsiva: Design moderno focado em usabilidade, com cards detalhados sobre as linhas e empresas.

Sistema de Gestão de Usuários: Autenticação completa com armazenamento seguro de senhas (hashing) via SQLite.

🛠️ Tecnologias Utilizadas
Backend: Python com o framework Flask.

Frontend: HTML5, CSS3 personalizado e JavaScript Vanilla.

Mapas: Leaflet.js integrando mapas do OpenStreetMap.

Dados Geográficos: OSRM (Open Source Routing Machine) para cálculo de trajetos de caminhada e condução.

Banco de Dados: SQLite para persistência de usuários.

Processamento de Dados: Pandas para manipulação e limpeza dos arquivos GTFS.

📂 Estrutura do Projeto
app.py: Servidor principal e API.

gtfs/: Arquivos de especificação de trânsito (stops, routes, stop_times).

static/: Arquivos estáticos (CSS, JS, imagens).

templates/: Telas HTML (Index, Login, Cadastro).

consertar_dados.py: Script utilitário para normalização e limpeza dos dados GTFS.

⚙️ Como Executar o Projeto
1. Clone o repositório:
Bash
git clone https://github.com/Gabriela-S2/cade_o_onibus.git
cd cadeo-onibus

2. Crie e ative um ambiente virtual:
Bash
python -m venv .venv
source .venv/bin/activate  # No Windows: .venv\Scripts\activate

3. Instale as dependências:
Bash
pip install -r requirements.txt

4. Prepare os dados (opcional):
Bash
python consertar_dados.py

Inicie a aplicação:
Bash
python app.py
O sistema estará disponível em http://127.0.0.1:5000 .
Bash
python app.py
O sistema estará disponível em http://127.0.0.1:5000.

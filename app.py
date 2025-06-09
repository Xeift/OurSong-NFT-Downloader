from flask import Flask, jsonify

from api.get.get_oursong_data import oursong_data_blueprint
from page.oursong_data_download_page import oursong_blueprint

app = Flask(__name__)

@app.route('/', methods=['GET'])
def home():
    return '首頁開發中QWQ'

app.register_blueprint(oursong_blueprint)
app.register_blueprint(oursong_data_blueprint)


if __name__ == '__main__':
    app.run(debug=True)

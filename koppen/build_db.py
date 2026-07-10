import json
import urllib.request
import time

cities_data = {
    "Af": ["Singapore, Singapore", "Kuala Lumpur, Malaysia", "Denpasar, Indonesia", "Batam, Indonesia", "Johor Bahru, Malaysia"],
    "Am": ["Miami, United States", "Jakarta, Indonesia", "Phuket, Thailand", "Manila, Philippines", "Cebu City, Philippines", "Colombo, Sri Lanka", "Krabi, Thailand", "Da Nang, Vietnam", "Penang Island, Malaysia"],
    "Aw": ["Bangkok, Thailand", "Mumbai, India", "Pattaya, Thailand", "Ho Chi Minh City, Vietnam", "Chennai, India", "Cancún, Mexico", "Rio de Janeiro, Brazil", "Chiang Mai, Thailand", "Kolkata, India", "Punta Cana, Dominican Republic", "Bangalore, India", "Pune, India", "Accra, Ghana", "Lagos, Nigeria"],
    "BWh": ["Dubai, United Arab Emirates", "Mecca, Saudi Arabia", "Medina, Saudi Arabia", "Las Vegas, United States", "Cairo, Egypt", "Riyadh, Saudi Arabia", "Dammam, Saudi Arabia", "Hurghada, Egypt", "Lima, Peru", "Abu Dhabi, United Arab Emirates"],
    "BWk": ["Turpan, China", "Ashgabat, Turkmenistan", "Neuquén, Argentina", "Leh, India", "Reno, United States", "Baku, Azerbaijan"],
    "BSh": ["Jaipur, India", "Marrakesh, Morocco", "Amman, Jordan", "Monterrey, Mexico", "Karachi, Pakistan", "Dakar, Senegal", "Agra, India"],
    "BSk": ["Denver, United States", "Zaragoza, Spain", "Ulaanbaatar, Mongolia", "Tehran, Iran", "Xi'an, China"],
    "Csa": ["Istanbul, Turkey", "Antalya, Turkey", "Rome, Italy", "Barcelona, Spain", "Athens, Greece", "Madrid, Spain", "Florence, Italy", "Jerusalem, Israel Palestine", "Lisbon, Portugal", "Heraklion, Greece", "Tel Aviv, Israel", "Muğla, Turkey", "Nice, France", "Rhodes, Greece", "Beirut, Lebanon", "Casablanca, Morocco", "Los Angeles, United States"],
    "Csb": ["San Francisco, United States", "Porto, Portugal", "San Jose, United States", "Cape Town, South Africa", "Bogota, Colombia"],
    "Cfa": ["New York City, United States", "Tokyo, Japan", "Taipei, Taiwan", "Osaka, Japan", "Shanghai, China", "Milan, Italy", "Orlando, United States", "Venice, Italy", "Sydney, Australia", "Guilin, China", "Buenos Aires, Argentina", "Chiba, Japan", "Fukuoka, Japan", "Jeju, South Korea", "São Paulo, Brazil", "Washington DC, United States", "Houston, United States", "Xiamen, China", "Atlanta, United States", "Montevideo, Uruguay", "Hangzhou, China", "Durban, South Africa", "Dallas Fort Worth, United States", "Philadelphia, United States"],
    "Cfb": ["London, United Kingdom", "Paris, France", "Prague, Czech Republic", "Amsterdam, Netherlands", "Vienna, Austria", "Berlin, Germany", "Dublin, Ireland", "Munich, Germany", "Brussels, Belgium", "Budapest, Hungary", "Vancouver, Canada", "Copenhagen, Denmark", "Melbourne, Australia", "Krakow, Poland", "Auckland, New Zealand", "Warsaw, Poland", "Frankfurt, Germany", "Zürich, Switzerland", "Düsseldorf, Germany", "Edinburgh, United Kingdom", "Hamburg, Germany", "Geneva, Switzerland", "Quito, Ecuador"],
    "Cwa": ["Hong Kong, Hong Kong", "Macau, Macau", "Delhi, India", "Shenzhen, China", "Guangzhou, China", "Ha Long, Vietnam", "Hanoi, Vietnam", "Zhuhai, China", "Chengdu, China", "Qingdao, China"],
    "Cwb": ["Mexico City, Mexico", "Nairobi, Kenya", "Addis Ababa, Ethiopia", "Cusco, Peru", "Kunming, China", "Johannesburg, South Africa"],
    "Dfa": ["Chicago, United States", "Boston, United States", "Bucharest, Romania", "Almaty, Kazakhstan", "Sapporo, Japan"],
    "Dfb": ["Moscow, Russia", "Toronto, Canada", "Saint Petersburg, Russia", "Stockholm, Sweden", "Montreal, Canada", "Sofia, Bulgaria", "Kyiv, Ukraine", "Helsinki, Finland"],
    "Dfc": ["Anchorage, United States", "Yellowknife, Canada", "Tromsø, Norway", "Murmansk, Russia", "Oulu, Finland", "Whitehorse, Canada"],
    "Dwa": ["Seoul, South Korea", "Beijing, China", "Dalian, China", "Tianjin, China", "Harbin, China", "Pyongyang, North Korea"],
    "Dwb": ["Vladivostok, Russia", "Irkutsk, Russia", "Khabarovsk, Russia", "Chita, Russia", "Qiqihar, China", "Ulan-Ude, Russia"],
    "ET": ["Nuuk, Greenland", "Iqaluit, Canada", "Longyearbyen, Svalbard", "Barrow (Utqiagvik), United States", "Stanley, Falkland Islands", "Tasiilaq, Greenland"],
    "EF": ["McMurdo Station, Antarctica", "Amundsen-Scott, Antarctica", "Vostok Station, Antarctica", "Summit Camp, Greenland", "Dome C, Antarctica", "Showas Station, Antarctica"]
}

# Load the previous JSON to keep the structure and some cities
with open("src/data/koppen.json", "r") as f:
    base_data = json.load(f)

# Build a mapping from classification to its group
class_to_group = {}
for g_id, g_data in base_data.items():
    for c_id in g_data["classifications"]:
        class_to_group[c_id] = g_id

out_data = base_data.copy()
for g in out_data:
    for c in out_data[g]["classifications"]:
        out_data[g]["classifications"][c]["cities"] = [] # clear

import ssl
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

cache = {}

for c_id, cities in cities_data.items():
    g_id = class_to_group.get(c_id)
    if not g_id: continue
    
    for city_str in cities:
        city_name = city_str.split(',')[0].strip()
        print(f"Fetching {city_str}...")
        url = f"https://geocoding-api.open-meteo.com/v1/search?name={urllib.parse.quote(city_name)}&count=1&language=en&format=json"
        
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, context=ctx) as response:
                res = json.loads(response.read().decode())
                if res.get("results"):
                    lat = res["results"][0]["latitude"]
                    lon = res["results"][0]["longitude"]
                    out_data[g_id]["classifications"][c_id]["cities"].append({
                        "name": city_str,
                        "lat": lat,
                        "lon": lon
                    })
                else:
                    print(f"NOT FOUND: {city_str}")
        except Exception as e:
            print(f"Error fetching {city_str}: {e}")
        time.sleep(0.5)

with open("src/data/koppen.json", "w") as f:
    json.dump(out_data, f, indent=2)

print("Done building DB")

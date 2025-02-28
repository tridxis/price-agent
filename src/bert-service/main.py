from fastapi import FastAPI
from transformers import pipeline, AutoTokenizer, AutoModelForSequenceClassification
from pydantic import BaseModel
import torch

app = FastAPI()

# Load FinBERT for financial sentiment and intent classification
finbert = pipeline(
    "text-classification",
    model="ProsusAI/finbert",
    device=-1  # Use CPU, change to 0 for GPU
)

# Load custom model for crypto-specific classification
crypto_classifier = pipeline(
    "text-classification",
    model="EleutherAI/gpt-neo-125M",  # Can be fine-tuned for crypto
    device=-1
)

# Load specialized token classifier for crypto symbols
token_classifier = pipeline(
    "token-classification",
    model="Jean-Baptiste/camembert-ner-with-dates",  # Good for detecting symbols and dates
    aggregation_strategy="simple"
)

class Question(BaseModel):
    text: str

@app.post("/analyze")
async def analyze_question(question: Question):
    # Classify trading intent
    trading_labels = [
        "price_query",
        "funding_query", 
        "long_signal",
        "short_signal",
        "trend_analysis",
        "volatility_analysis",
        "market_sentiment"
    ]
    
    # Get financial sentiment
    sentiment = finbert(question.text)[0]
    
    # Get trading intent
    intent_result = crypto_classifier(
        question.text,
        candidate_labels=trading_labels,
        multi_label=True
    )

    # Extract entities (crypto symbols, timeframes, amounts)
    entities = token_classifier(question.text)
    
    # Enhanced entity mapping for crypto/trading
    entity_mapping = {
        "ORG": "CRYPTO",      # Organizations/Tokens
        "MISC": "CRYPTO",     # Misc symbols
        "DATE": "TIMEFRAME",  # Temporal references
        "PERCENT": "RATE",    # Rates and percentages
        "MONEY": "AMOUNT"     # Price levels
    }

    # Enhanced entity processing
    formatted_entities = []
    for e in entities:
        entity_type = entity_mapping.get(e["entity_group"], e["entity_group"])
        value = e["word"]
        
        # Clean up crypto symbols
        if entity_type == "CRYPTO":
            value = value.upper().replace("$", "").strip()
        
        formatted_entities.append({
            "type": entity_type,
            "value": value,
            "confidence": e["score"]
        })

    return {
        "intent": {
            "primary": intent_result[0]["label"],
            "confidence": intent_result[0]["score"],
            "secondary": [
                {"label": r["label"], "score": r["score"]} 
                for r in intent_result[1:3]  # Get top 3 intents
            ]
        },
        "sentiment": {
            "label": sentiment["label"],
            "score": sentiment["score"]
        },
        "entities": formatted_entities
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000) 
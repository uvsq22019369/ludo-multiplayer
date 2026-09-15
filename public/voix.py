import asyncio
import edge_tts

texte = """Elle dit qu'elle est de bonne humeur,
Mais j'crois qu'elle cache bien son jeu,
Elle me fait jouer, elle me fait chanter,
Et après ça, c'est moi le malheureux"""

async def main():
    voix = "fr-FR-HenriNeural"
    communicate = edge_tts.Communicate(
        texte,
        voix,
        rate="+10%",
        pitch="+30Hz"
    )
    await communicate.save("sortie_ado.mp3")
    print("Fichier audio généré : sortie_ado.mp3")

asyncio.run(main())
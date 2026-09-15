from pydub import AudioSegment

# Charger les fichiers (tous dans le même dossier que ce script)
voix = AudioSegment.from_mp3("sortie_ado.mp3")
musique = AudioSegment.from_mp3("High Beams - True Blue Music _ Eclipt.mp3")

# Réduire le volume de la musique pour laisser la voix bien audible
musique = musique - 15  # ajuste ce chiffre : -20 = plus discret, -10 = plus fort

# Ajuster la durée de la musique à celle de la voix
if len(musique) > len(voix):
    musique = musique[:len(voix)]
else:
    boucles = (len(voix) // len(musique)) + 1
    musique = (musique * boucles)[:len(voix)]

# Superposer voix et musique
resultat = voix.overlay(musique)

# Exporter le résultat final
resultat.export("chanson_finale.mp3", format="mp3")
print("Fichier final généré : chanson_finale.mp3")
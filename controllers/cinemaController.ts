import { Request, Response, NextFunction } from "express";
import { supabase } from "../config/supabase";

export const getAllCinemas = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        const { data, error } = await supabase
            .from('cinemas')
            .select('*, cities(name)')
            .eq('is_active', true);

        if (error) throw error;
        res.json(data);
    } catch (err) {
        next(err);
    }
};

export const getCinemaShowtimes = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const cinemaId = req.params.id;

    try {
        // 0. Fetch Cinema Details
        const { data: cinemaData, error: cinemaError } = await supabase
            .from('cinemas')
            .select('id, name, hearing_assistance, wheelchair_access, image_url, description')
            .eq('id', cinemaId)
            .single();

        if (cinemaError) throw cinemaError;

        // 1. Fetch Halls for this cinema
        const { data: hallsData, error: hallsError } = await supabase
            .from('halls')
            .select('id, name')
            .eq('cinema_id', cinemaId);

        if (hallsError) throw hallsError;
        if (!hallsData || hallsData.length === 0) {
            res.json({ cinema: cinemaData, movies: [] });
            return;
        }

        const hallIds = hallsData.map(h => h.id);

        // 2. Fetch Showtimes for these halls, with nested Movie data
        let showtimesQuery = supabase
            .from('showtimes')
            .select(`
                id,
                hall_id,
                start_time,
                movies (
                    id,
                    title,
                    poster_url,
                    language,
                    movie_genres (
                        genres (
                            name
                        )
                    )
                )
            `)
            .in('hall_id', hallIds);

        const dateQuery = req.query.date as string;
        if (dateQuery) {
            showtimesQuery = showtimesQuery
                .gte('start_time', `${dateQuery}T00:00:00.000Z`)
                .lte('start_time', `${dateQuery}T23:59:59.999Z`);
        }

        const { data: showtimesData, error: showtimesError } = await showtimesQuery;

        if (showtimesError) throw showtimesError;

        // 3. Transform the flat showtimesData into structured nested object: Movie -> Halls -> Schedules
        const moviesMap = new Map<string, any>();

        showtimesData?.forEach((showtime: any) => {
            const movie = showtime.movies;
            if (!movie) return;

            const movieId = movie.id;
            const hallId = showtime.hall_id;
            const timeMatch = showtime.start_time.match(/T(\d{2}:\d{2})/);
            const timeString = timeMatch ? timeMatch[1] : showtime.start_time;

            const tags = [movie.language];
            if (movie.movie_genres) {
                movie.movie_genres.forEach((mg: any) => {
                    if (mg.genres?.name) tags.push(mg.genres.name);
                });
            }

            const scheduleObj = { id: showtime.id, time: timeString };

            if (!moviesMap.has(movieId)) {
                moviesMap.set(movieId, {
                    id: movieId,
                    title: movie.title,
                    posterUrl: movie.poster_url,
                    tags: tags.filter(Boolean),
                    hallsMap: new Map<string, any>()
                });
            }

            const currentMovie = moviesMap.get(movieId);

            if (!currentMovie.hallsMap.has(hallId)) {
                const hallInfo = hallsData.find(h => h.id === hallId);
                currentMovie.hallsMap.set(hallId, {
                    id: hallId,
                    name: hallInfo?.name || `Hall ${hallId.substring(0, 4)}`,
                    schedules: []
                });
            }

            const currentHall = currentMovie.hallsMap.get(hallId);
            currentHall.schedules.push(scheduleObj);
        });

        // 4. Convert Maps to final Array structure for the Frontend Response
        const finalResponse = Array.from(moviesMap.values()).map(movie => {
            const hallsArray = Array.from((movie.hallsMap as Map<string, any>).values()).map(hall => {
                hall.schedules.sort((a: any, b: any) => a.time.localeCompare(b.time));
                return hall;
            });

            hallsArray.sort((a, b) => a.name.localeCompare(b.name));

            return {
                id: movie.id,
                title: movie.title,
                posterUrl: movie.posterUrl,
                tags: movie.tags,
                halls: hallsArray
            };
        });

        res.json({
            cinema: cinemaData,
            movies: finalResponse
        });
    } catch (err) {
        next(err);
    }
};
